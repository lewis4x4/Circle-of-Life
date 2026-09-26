#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "lewis4x4/Circle-of-Life";
const SHA = /^[0-9a-f]{40}$/;
const root = `/repos/${REPOSITORY}`;
const workflowPath = `${root}/actions/workflows/ci-gates.yml`;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function validateTarget({ expected, actual, checkedOut, base, parent, ref, repository }) {
  requireValue(repository === REPOSITORY && ref === "refs/heads/main", "Dispatch must target this repository's main branch");
  requireValue([expected, actual, checkedOut, base, parent].every((s) => SHA.test(s ?? "")), "Dispatch requires full commit and first-parent SHAs");
  requireValue(checkedOut === actual, "Checked-out source differs from the native CI revision");
  requireValue(expected === actual, `Main advanced before dispatch: expected ${expected}, actual ${actual}; no gates have run`);
  requireValue(base === parent, "Dispatch diff must start at the tested commit's first parent");
}

function validateRun(run, workflowId) {
  requireValue(Number.isSafeInteger(run.id) && run.id > 0 && run.workflow_id === workflowId, "Unexpected primary CI run identity");
  requireValue(run.repository?.full_name === REPOSITORY && run.head_branch === "main" && SHA.test(run.head_sha ?? ""), "Unexpected primary CI run source");
}

export async function reconcile({ api, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() }) {
  const workflow = await api("GET", workflowPath);
  requireValue(Number.isSafeInteger(workflow.id) && workflow.state === "active" && workflow.path === ".github/workflows/ci-gates.yml", "Primary CI workflow is not active");
  for (let attempt = 0; attempt < 3; attempt++) {
    const commit = await api("GET", `${root}/commits/main`);
    const sha = commit.sha;
    const base = commit.parents?.[0]?.sha;
    requireValue(SHA.test(sha ?? "") && SHA.test(base ?? ""), "Main commit or first parent is missing");
    const existing = [];
    for (let page = 1; page <= 5; page++) {
      const data = await api("GET", `${workflowPath}/runs?branch=main&head_sha=${sha}&per_page=100&page=${page}`);
      requireValue(Array.isArray(data.workflow_runs), "Missing primary CI run inventory");
      for (const run of data.workflow_runs) {
        validateRun(run, workflow.id);
        requireValue(run.head_sha === sha, "Run inventory returned another revision");
        existing.push(run);
      }
      if (data.workflow_runs.length < 100) break;
      requireValue(page < 5, "Primary CI inventory exceeded its bounded scan");
    }
    // A raced dispatch is rejected before classification. Its native checks
    // must never count as proof for the newer SHA captured by GitHub.
    const valid = existing.find((run) => {
      // PR runs (including a fork branch named main) are not post-merge CI.
      if (!["push", "workflow_dispatch"].includes(run.event)) return false;
      requireValue(run.head_repository?.full_name === REPOSITORY, "Primary CI run came from another head repository");
      const requested = /^Main CI for ([0-9a-f]{40}) from ([0-9a-f]{40})$/.exec(run.display_title ?? "");
      return run.event === "push" || (requested?.[1] === sha && requested[2] === base);
    });
    if (valid) return { action: "existing", sha, run_id: valid.id, status: valid.status, conclusion: valid.conclusion };

    const started = now();
    const result = await api("POST", `${workflowPath}/dispatches`, { ref: "main", inputs: { expected_sha: sha, base_sha: base } });
    let runId = result?.workflow_run_id;
    // The 2026 API returns the run id; retain safe readback for older 204 responses.
    for (let poll = 0; !runId && poll < 10; poll++) {
      const data = await api("GET", `${workflowPath}/runs?branch=main&event=workflow_dispatch&per_page=100`);
      requireValue(Array.isArray(data.workflow_runs), "Missing dispatch readback");
      const run = data.workflow_runs.find((r) => r.display_title === `Main CI for ${sha} from ${base}` && !existing.some((e) => e.id === r.id) && Date.parse(r.created_at) >= started - 10_000);
      runId = run?.id;
      if (!runId) await pause(1000);
    }
    requireValue(Number.isSafeInteger(runId) && runId > 0, "Dispatch was accepted but no run could be verified");
    let run;
    for (let poll = 0; poll < 10; poll++) {
      run = await api("GET", `${root}/actions/runs/${runId}`);
      validateRun(run, workflow.id);
      requireValue(run.head_repository?.full_name === REPOSITORY, "Dispatch came from another head repository");
      if (run.event === "workflow_dispatch" && run.display_title === `Main CI for ${sha} from ${base}`) break;
      // The run id is returned before GitHub finishes evaluating run-name.
      // Read the same immutable id; do not submit another dispatch for this delay.
      if (poll < 9) await pause(1000);
    }
    requireValue(run.event === "workflow_dispatch" && run.display_title === `Main CI for ${sha} from ${base}`, "Dispatch readback does not match the requested revision");
    if (run.head_sha === sha) return { action: "dispatched", sha, base_sha: base, run_id: runId, url: `https://github.com/${REPOSITORY}/actions/runs/${runId}` };
    // GitHub resolves main when accepting the dispatch. Retry the new tip;
    // the expected-SHA guard makes the raced run fail instead of testing it.
  }
  throw new Error("Main kept advancing during dispatch; no exact-revision run was verified");
}

export function createApi(token, fetchImpl = fetch) {
  requireValue(typeof token === "string" && token.length > 0, "GitHub credential is missing");
  let requests = 0;
  return async (method, endpoint, body) => {
    requireValue(++requests <= 50 && endpoint.startsWith(`${root}/`), "GitHub request exceeded its repository or count boundary");
    const response = await fetchImpl(`https://api.github.com${endpoint}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    requireValue(response.ok, `GitHub ${method} request failed with HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
}

async function main() {
  if (process.argv[2] === "validate") {
    const parent = spawnSync("git", ["rev-parse", "HEAD", "HEAD^"], { encoding: "utf8" });
    requireValue(parent.status === 0, "Cannot resolve dispatch first parent");
    const [checkedOut, firstParent] = parent.stdout.trim().split("\n");
    validateTarget({ expected: process.env.EXPECTED_MAIN_SHA, actual: process.env.GITHUB_SHA, checkedOut, base: process.env.EXPECTED_BASE_SHA, parent: firstParent, ref: process.env.GITHUB_REF, repository: process.env.GITHUB_REPOSITORY });
    console.log("Dispatch revision and first-parent boundary verified");
    return;
  }
  requireValue(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === "refs/heads/main", "Reconciliation must run from trusted main");
  console.log(JSON.stringify(await reconcile({ api: createApi(process.env.GITHUB_TOKEN) })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
