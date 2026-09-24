// Linear delivery for the Haven scheduled-job monitor (check.mjs --send-linear).
//
//   failing job, no open issue      -> reopen the job's issue if it closed inside the dedupe
//                                      window, otherwise create one (assigned, labeled, prioritized)
//   failing job, open issue exists  -> same signature: no writes; changed signature: comment,
//                                      or only refresh the Failure line inside the dedupe window
//   healthy job, open issue exists  -> comment "recovered" and move the issue to Done
//
// Only outcomes that survived monitor.mjs's applyAlertPolicy arrive here as failing.
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

// COL-547 dedupe window: a job alerts at most once per window. A signature change inside
// it updates the issue silently; a job that flaps back to failing reopens the same issue.
export const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

const FAILURE_LINE = /^\*\*Failure:\*\* (.*)$/m;
const LAST_ALERT_LINE = /^\*\*Last alert:\*\* (.*)$/m;
const FIRST_SEEN_LINE = /^\*\*First seen:\*\* (.*)$/m;

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

// When the last notifying write happened; falls back to First seen for older issues.
export function readLastAlert(description) {
  const match = (description ?? '').match(LAST_ALERT_LINE) ?? (description ?? '').match(FIRST_SEEN_LINE);
  const at = match ? Date.parse(match[1].trim()) : NaN;
  return Number.isFinite(at) ? new Date(at) : null;
}

export function replaceLastAlert(description, now) {
  const line = `**Last alert:** ${now.toISOString()}`;
  if (LAST_ALERT_LINE.test(description ?? '')) return description.replace(LAST_ALERT_LINE, line);
  if (FIRST_SEEN_LINE.test(description ?? '')) return description.replace(FIRST_SEEN_LINE, m => `${m}\n${line}`);
  return `${line}\n\n${description ?? ''}`;
}

export function buildDescription(result, { runUrl, now }) {
  const lines = [
    `**Job:** \`${result.job}\``,
    `**Failure:** ${(result.signature ?? 'Failing').trim()}`,
    `**First seen:** ${now.toISOString()}`,
    `**Last alert:** ${now.toISOString()}`,
  ];
  if (runUrl) lines.push(`**Monitor run:** ${runUrl}`);
  return `${lines.join('\n')}${result.detail ? `\n\n${result.detail.trim()}` : ''}

---
Opened by the Haven scheduled-job monitor after its alert policy confirmed the failure (COL-547). It comments here when the failure changes (at most once per ${DEDUPE_WINDOW_MS / 3600000} hours), closes this issue when the job recovers, and reopens it if the job fails again within ${DEDUPE_WINDOW_MS / 3600000} hours.`;
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
        o.likely_cause ? `- Likely cause: ${o.likely_cause}` : null,
        o.alert_reason ? `- Alerting because: ${o.alert_reason}` : null,
        o.http_status ? `- HTTP status: ${o.http_status}` : null,
        o.consecutive_failures != null ? `- Consecutive failures: ${o.consecutive_failures}` : null,
        'last_success_at' in o ? `- Last success: ${o.last_success_at ?? 'none in the last 100 recorded runs'}` : null,
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
  // Filtered on completedAt client-side; newest update first.
  findRecentClosed: `
    query FindRecentClosedJobIssue($teamId: ID!, $title: String!) {
      issues(
        first: 5
        orderBy: updatedAt
        filter: {
          team: { id: { eq: $teamId } }
          title: { eq: $title }
          state: { type: { eq: "completed" } }
        }
      ) {
        nodes { id identifier url description completedAt }
      }
    }`,
  reopenState: `
    query ReopenState($teamId: ID!) {
      workflowStates(first: 10, filter: { team: { id: { eq: $teamId } }, type: { eq: "unstarted" } }) {
        nodes { id name position }
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
  const window = config.dedupeWindowMs ?? DEDUPE_WINDOW_MS;
  const summary = { created: [], reopened: [], commented: [], updated: [], closed: [], unchanged: [], errors: [] };
  let doneStateId = null;
  let reopenStateId = null;
  const firstState = async (query) => {
    const data = await gql(config, query, { teamId: config.teamId });
    const states = [...data.workflowStates.nodes].sort((a, b) => a.position - b.position);
    return states[0]?.id ?? null;
  };

  for (const result of results) {
    try {
      const found = await gql(config, QUERIES.findOpen, { teamId: config.teamId, title: issueTitle(result.job) });
      const open = found.issues.nodes[0] ?? null;

      if (result.status === 'healthy') {
        if (!open) continue;
        if (!doneStateId) {
          doneStateId = await firstState(QUERIES.doneState);
          if (!doneStateId) throw new Error('Linear team has no completed workflow state');
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
      const run = config.runUrl ? `\n\n[Monitor run](${config.runUrl})` : '';
      const detail = result.detail ? `\n\n${result.detail.trim()}` : '';
      if (!open) {
        const recent = await gql(config, QUERIES.findRecentClosed, { teamId: config.teamId, title: issueTitle(result.job) });
        const closed = recent.issues.nodes.find(i => i.completedAt && now - Date.parse(i.completedAt) < window);
        if (closed) {
          if (!reopenStateId) {
            reopenStateId = await firstState(QUERIES.reopenState);
            if (!reopenStateId) throw new Error('Linear team has no unstarted workflow state');
          }
          await gql(config, QUERIES.comment, {
            input: { issueId: closed.id, body: `Failing again at ${now.toISOString()}, within ${window / 3600000} hours of recovery: **${signature}**. Reopened instead of opening a new issue.${detail}${run}` },
          });
          await gql(config, QUERIES.update, {
            id: closed.id,
            input: { stateId: reopenStateId, description: replaceLastAlert(replaceSignature(closed.description, signature), now) },
          });
          summary.reopened.push(closed.identifier);
          continue;
        }
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
      const lastAlert = readLastAlert(open.description);
      if (lastAlert && now - lastAlert < window) {
        // Inside the dedupe window: keep the issue current without notifying anyone again.
        await gql(config, QUERIES.update, { id: open.id, input: { description: replaceSignature(open.description, signature) } });
        summary.updated.push(open.identifier);
        continue;
      }
      await gql(config, QUERIES.comment, {
        input: {
          issueId: open.id,
          body: `Failure changed: **${previous ?? 'unknown'}** → **${signature}** at ${now.toISOString()}.${detail}${run}`,
        },
      });
      await gql(config, QUERIES.update, {
        id: open.id,
        input: { description: replaceLastAlert(replaceSignature(open.description, signature), now) },
      });
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
