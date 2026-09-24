// Linear delivery for the Haven scheduled-job monitor (check.mjs --send-linear).
//
//   failing job, no open issue      -> create one issue (assigned, labeled "Scheduled job", prioritized)
//   failing job, open issue exists  -> comment only when the failure signature changes
//   healthy job, open issue exists  -> comment "recovered" and move the issue to Done
//
// Issues are created by a Linear OAuth app (client credentials), not by a person, so the
// assignee is notified. New issues trigger the "Scheduled job failure" Linear loop.
//
// Env: LINEAR_MONITOR_CLIENT_ID, LINEAR_MONITOR_CLIENT_SECRET (required)
//      LINEAR_TEAM_ID, LINEAR_LABEL_ID, LINEAR_ASSIGNEE_ID (optional; default to Haven's)
//      MONITOR_RUN_URL (optional; derived from GitHub Actions env when unset)

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

export const HAVEN_DEFAULTS = {
  teamId: 'f410a3d9-f495-4637-8014-cc7bd9ef5282', // Circle of Life / GSMS
  labelId: 'd2741367-bfe7-41ea-98b1-d6f38570d5c9', // Scheduled job
  assigneeId: 'bc888813-9584-4e84-85f7-125676e49d9b', // Brian Lewis
};
export const MONITOR_JOB = 'job-monitor';
export const TITLE_PREFIX = 'Scheduled job alert: ';
// Resident safety, medication, escalation, and the monitor itself page as Urgent.
export const URGENT_JOBS = /resident-safety|escalat|emar|missed-dose|^job-monitor$/i;

const FAILURE_LINE = /^\*\*Failure:\*\* (.*)$/m;

/**
 * @typedef {Object} JobResult
 * @property {string} job                 Cron job name, e.g. "stand-up-google-inbound".
 * @property {'failing'|'healthy'} status
 * @property {string} [signature]         Short, stable failure summary; a change triggers one comment.
 * @property {string} [detail]            Markdown detail for the issue body or change comment.
 */

export const issueTitle = job => `${TITLE_PREFIX}${job}`;
export const priorityFor = (job, urgent = URGENT_JOBS) => (urgent.test(job) ? 1 : 2);

export function readSignature(description) {
  const match = (description ?? '').match(FAILURE_LINE);
  return match ? match[1].trim() : null;
}

export function replaceSignature(description, signature) {
  return FAILURE_LINE.test(description ?? '')
    ? description.replace(FAILURE_LINE, `**Failure:** ${signature}`)
    : `**Failure:** ${signature}\n\n${description ?? ''}`;
}

export function buildDescription(result, { runUrl, now }) {
  const lines = [
    `**Job:** \`${result.job}\``,
    `**Failure:** ${(result.signature ?? 'Failing').trim()}`,
    `**First seen:** ${now.toISOString()}`,
  ];
  if (runUrl) lines.push(`**Monitor run:** ${runUrl}`);
  return `${lines.join('\n')}${result.detail ? `\n\n${result.detail.trim()}` : ''}

---
Opened by the Haven scheduled-job monitor. It comments here when the failure changes and closes this issue when the job recovers.`;
}

// Maps check.mjs output (assessJob outcomes + secret parity) to one result per job.
// Only a successful latest run with matching secrets counts as healthy; other quiet
// states (awaiting_first_run, disabled, governance refusal) leave any open issue alone.
export function toJobResults(outcomes = [], parity = []) {
  const jobs = new Map();
  const entry = (name) => {
    if (!jobs.has(name)) jobs.set(name, { problems: [], details: [], success: false });
    return jobs.get(name);
  };
  for (const o of outcomes) {
    const e = entry(o.jobname ?? `job-${o.jobid}`);
    if (!o.alert) {
      if (o.state === 'success') e.success = true;
      continue;
    }
    e.problems.push(o.state === 'not_monitored' ? 'Not monitored' : `${o.state}${o.http_status ? ` (HTTP ${o.http_status})` : ''}`);
    e.details.push(
      [
        `- State: \`${o.state}\``,
        o.http_status ? `- HTTP status: ${o.http_status}` : null,
        o.consecutive_failures != null ? `- Consecutive failures: ${o.consecutive_failures}` : null,
        o.requested_at ? `- Last run: ${o.requested_at}${o.request_id != null ? ` (request ${o.request_id})` : ''}` : null,
        o.expected_at ? `- Expected at: ${o.expected_at}` : null,
        o.endpoint ? `- Endpoint: \`${o.endpoint}\`` : null,
      ].filter(Boolean).join('\n'),
    );
  }
  for (const p of parity) {
    if (p.state === 'match') continue;
    const e = entry(p.jobname ?? `job-${p.jobid}`);
    e.problems.push(`secret ${p.state}`);
    e.details.push(`- Secret parity: \`${p.state}\`${p.endpoint ? ` (endpoint \`${p.endpoint}\`)` : ''}`);
  }
  return [...jobs.entries()].flatMap(([job, e]) => {
    if (e.problems.length) return [{ job, status: 'failing', signature: e.problems.join(' + '), detail: e.details.join('\n') }];
    return e.success ? [{ job, status: 'healthy' }] : [];
  });
}

// Error text stays free of provider bodies, matching check.mjs's logging policy.
export async function getLinearToken({ clientId, clientSecret, fetchImpl = fetch }) {
  if (!clientId || !clientSecret) throw new Error('LINEAR_MONITOR_CLIENT_ID and LINEAR_MONITOR_CLIENT_SECRET are required');
  const res = await fetchImpl(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'read,write' }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Linear token request failed: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Linear token response had no access_token');
  return json.access_token;
}

async function gql(config, query, variables) {
  const res = await (config.fetchImpl ?? fetch)(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const codes = (json.errors ?? []).map(e => e.extensions?.code ?? 'error').join(',') || 'no_body';
    throw new Error(`Linear API HTTP ${res.status}: ${codes}`);
  }
  return json.data;
}

export const QUERIES = {
  findOpen: `
    query FindOpenJobIssue($teamId: ID!, $title: String!) {
      issues(
        first: 5
        filter: {
          team: { id: { eq: $teamId } }
          title: { eq: $title }
          state: { type: { nin: ["completed", "canceled"] } }
        }
      ) {
        nodes { id identifier url description }
      }
    }`,
  doneState: `
    query DoneState($teamId: ID!) {
      workflowStates(first: 10, filter: { team: { id: { eq: $teamId } }, type: { eq: "completed" } }) {
        nodes { id name position }
      }
    }`,
  create: `
    mutation CreateJobIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
  update: `
    mutation UpdateJobIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
  comment: `
    mutation CommentJobIssue($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
};

/**
 * @param {JobResult[]} results
 * @param {{token:string, teamId:string, labelId:string, assigneeId:string, runUrl?:string,
 *          urgent?:RegExp, fetchImpl?:typeof fetch, now?:() => Date}} config
 */
export async function syncJobIssues(results, config) {
  const now = (config.now ?? (() => new Date()))();
  const summary = { created: [], commented: [], closed: [], unchanged: [], errors: [] };
  let doneStateId = null;

  for (const result of results) {
    try {
      const found = await gql(config, QUERIES.findOpen, { teamId: config.teamId, title: issueTitle(result.job) });
      const open = found.issues.nodes[0] ?? null;

      if (result.status === 'healthy') {
        if (!open) continue;
        if (!doneStateId) {
          const data = await gql(config, QUERIES.doneState, { teamId: config.teamId });
          const states = [...data.workflowStates.nodes].sort((a, b) => a.position - b.position);
          if (!states.length) throw new Error('Linear team has no completed workflow state');
          doneStateId = states[0].id;
        }
        const run = config.runUrl ? ` ([monitor run](${config.runUrl}))` : '';
        await gql(config, QUERIES.comment, {
          input: { issueId: open.id, body: `Recovered: \`${result.job}\` is healthy as of ${now.toISOString()}${run}. Closing.` },
        });
        await gql(config, QUERIES.update, { id: open.id, input: { stateId: doneStateId } });
        summary.closed.push(open.identifier);
        continue;
      }

      const signature = (result.signature ?? 'Failing').trim();
      if (!open) {
        const data = await gql(config, QUERIES.create, {
          input: {
            teamId: config.teamId,
            title: issueTitle(result.job),
            description: buildDescription(result, { runUrl: config.runUrl, now }),
            labelIds: [config.labelId],
            assigneeId: config.assigneeId,
            priority: priorityFor(result.job, config.urgent),
          },
        });
        if (!data.issueCreate.success) throw new Error('Linear issueCreate returned success=false');
        summary.created.push(data.issueCreate.issue.identifier);
        continue;
      }

      const previous = readSignature(open.description);
      if (previous === signature) {
        summary.unchanged.push(open.identifier);
        continue;
      }
      const run = config.runUrl ? `\n\n[Monitor run](${config.runUrl})` : '';
      const detail = result.detail ? `\n\n${result.detail.trim()}` : '';
      await gql(config, QUERIES.comment, {
        input: {
          issueId: open.id,
          body: `Failure changed: **${previous ?? 'unknown'}** → **${signature}** at ${now.toISOString()}.${detail}${run}`,
        },
      });
      await gql(config, QUERIES.update, { id: open.id, input: { description: replaceSignature(open.description, signature) } });
      summary.commented.push(open.identifier);
    } catch (error) {
      summary.errors.push({ job: result.job, message: String(error?.message ?? error) });
    }
  }
  return summary;
}

export function monitorRunUrl(env = process.env) {
  if (env.MONITOR_RUN_URL) return env.MONITOR_RUN_URL;
  if (env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  return undefined;
}

export async function sendLinear(results, env = process.env, fetchImpl = fetch) {
  const token = await getLinearToken({
    clientId: env.LINEAR_MONITOR_CLIENT_ID,
    clientSecret: env.LINEAR_MONITOR_CLIENT_SECRET,
    fetchImpl,
  });
  return syncJobIssues(results, {
    token,
    teamId: env.LINEAR_TEAM_ID || HAVEN_DEFAULTS.teamId,
    labelId: env.LINEAR_LABEL_ID || HAVEN_DEFAULTS.labelId,
    assigneeId: env.LINEAR_ASSIGNEE_ID || HAVEN_DEFAULTS.assigneeId,
    runUrl: monitorRunUrl(env),
    fetchImpl,
  });
}
