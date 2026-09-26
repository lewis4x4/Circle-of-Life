import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createApi, reconcile, REPOSITORY, validateTarget } from "./dispatch-main-ci.mjs";

const sha = "a".repeat(40);
const base = "b".repeat(40);
const newer = "c".repeat(40);
const wf = { id: 1, path: ".github/workflows/ci-gates.yml", state: "active" };
const run = (extra = {}) => ({ id: 10, run_attempt: 1, workflow_id: 1, repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, head_branch: "main", head_sha: sha, event: "workflow_dispatch", display_title: "CI — segment gates", status: "queued", conclusion: null, ...extra });

function fixture({ existing = [], readback = run(), response = { workflow_run_id: 10 }, guard = "success" } = {}) {
  const writes = [];
  const api = async (method, endpoint, body) => {
    if (method === "POST") { writes.push({ endpoint, body }); return response; }
    if (endpoint.endsWith("/commits/main")) return { sha, parents: [{ sha: base }] };
    if (endpoint.endsWith("/actions/workflows/ci-gates.yml")) return wf;
    if (endpoint.includes("head_sha=")) return { workflow_runs: existing };
    if (endpoint.endsWith("/attempts/1/jobs?per_page=100")) return { jobs: [{ run_id: 10, name: "Classify change risk", steps: guard === null ? [] : [{ name: "Validate dispatched main revision", conclusion: guard }] }] };
    if (endpoint.endsWith("/actions/runs/10")) return readback;
    throw new Error(`Unexpected fixture request: ${endpoint}`);
  };
  return { api, writes };
}

test("missing primary CI is explicitly dispatched and exact run identity is read back", async () => {
  const f = fixture();
  const result = await reconcile({ api: f.api });
  assert.equal(result.action, "dispatched");
  assert.equal(result.sha, sha);
  assert.equal(result.run_id, 10);
  assert.deepEqual(f.writes[0].body, { ref: "main", inputs: { expected_sha: sha, base_sha: base } });
});

for (const [status, conclusion] of [["queued", null], ["in_progress", null], ["completed", "success"], ["completed", "failure"], ["completed", "cancelled"]]) {
  test(`existing ${status}/${conclusion} run is retained without repeating gates`, async () => {
    const f = fixture({ existing: [run({ status, conclusion })] });
    const result = await reconcile({ api: f.api });
    assert.equal(result.action, "existing");
    assert.equal(result.conclusion, conclusion);
    assert.equal(f.writes.length, 0);
  });
}

test("an accepted dispatch without a returned run id is not assumed successful", async () => {
  const f = fixture();
  const api = async (...args) => args[0] === "POST" ? (await f.api(...args), undefined) : f.api(...args);
  await assert.rejects(reconcile({ api }), /no run could be verified/);
});

test("unverifiable accepted dispatch fails visibly", async () => {
  const f = fixture();
  const api = async (...args) => args[0] === "POST" ? undefined : args[1].includes("event=workflow_dispatch") ? { workflow_runs: [] } : f.api(...args);
  await assert.rejects(reconcile({ api, pause: async () => {} }), /no run could be verified/);
});

test("readback uses the accepted run identity without relying on late display-title metadata", async () => {
  const f = fixture();
  let reads = 0;
  const api = async (...args) => {
    if (args[1].endsWith("/actions/runs/10")) { reads++; return run({ display_title: "not yet hydrated" }); }
    return f.api(...args);
  };
  assert.equal((await reconcile({ api, pause: async () => {} })).action, "dispatched");
  assert.equal(reads, 1);
  assert.equal(f.writes.length, 1, "metadata delay must not repeat the dispatch");
});

test("a different returned run id remains a visible readback failure", async () => {
  const f = fixture({ readback: run({ id: 11 }) });
  await assert.rejects(reconcile({ api: f.api, pause: async () => {} }), /does not match/);
  assert.equal(f.writes.length, 1);
});

test("raced dispatch cannot satisfy the newer commit's CI inventory", async () => {
  const f = fixture({ existing: [run({ status: "completed", conclusion: "failure" })], guard: "failure" });
  assert.equal((await reconcile({ api: f.api })).action, "dispatched");
  assert.equal(f.writes.length, 1);
});

test("malformed expected SHA or wrong first parent cannot suppress valid primary CI", async () => {
  for (const guard of ["failure", "skipped", null]) {
    const f = fixture({ existing: [run({ status: "completed", conclusion: "failure" })], guard });
    assert.equal((await reconcile({ api: f.api })).action, "dispatched");
  }
});

test("a fork PR branch named main cannot substitute for post-merge CI", async () => {
  const f = fixture({ existing: [run({ event: "pull_request", head_repository: { full_name: "fork/repo" }, status: "completed", conclusion: "success" })] });
  assert.equal((await reconcile({ api: f.api })).action, "dispatched");
});

test("main advance during dispatch retries the new tip with its own parent", async () => {
  let attempt = 0;
  const bodies = [];
  const api = async (method, endpoint, body) => {
    if (endpoint.endsWith("/actions/workflows/ci-gates.yml")) return wf;
    if (endpoint.endsWith("/commits/main")) return attempt ? { sha: newer, parents: [{ sha }] } : { sha, parents: [{ sha: base }] };
    if (endpoint.includes("head_sha=")) return { workflow_runs: [] };
    if (method === "POST") { bodies.push(body); attempt++; return { workflow_run_id: attempt }; }
    if (endpoint.endsWith("/actions/runs/1")) return run({ id: 1, head_sha: newer });
    if (endpoint.endsWith("/actions/runs/2")) return run({ id: 2, head_sha: newer, display_title: `Main CI for ${newer} from ${sha}` });
    throw new Error(endpoint);
  };
  const result = await reconcile({ api });
  assert.equal(result.sha, newer);
  assert.deepEqual(bodies[1].inputs, { expected_sha: newer, base_sha: sha });
});

test("invalid inventory and API failure do not become healthy CI", async () => {
  for (const bad of [run({ head_branch: "feature" }), run({ repository: { full_name: "other/repo" } }), run({ head_sha: newer }), run({ workflow_id: 2 })]) {
    const f = fixture({ existing: [bad] });
    await assert.rejects(reconcile({ api: f.api }), /Unexpected|another revision/);
    assert.equal(f.writes.length, 0);
  }
  await assert.rejects(reconcile({ api: async () => { throw new Error("API unavailable"); } }), /API unavailable/);
});

test("revision guard rejects a race, wrong checkout, wrong branch and unsafe base", () => {
  const target = { expected: sha, actual: sha, checkedOut: sha, base, parent: base, ref: "refs/heads/main", repository: REPOSITORY };
  validateTarget(target);
  for (const override of [{ expected: newer }, { checkedOut: newer }, { base: newer }, { base: "main" }, { ref: "refs/heads/feature" }, { repository: "other/repo" }]) {
    assert.throws(() => validateTarget({ ...target, ...override }));
  }
});

test("transport uses explicit dispatch-capable permissions without leaking API error bodies", async () => {
  const api = createApi("synthetic-token", async (_url, init) => {
    assert.equal(init.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.equal(init.redirect, "error");
    return { ok: false, status: 403, json: async () => ({ message: "sensitive remote body" }) };
  });
  await assert.rejects(api("POST", `/repos/${REPOSITORY}/actions/workflows/ci-gates.yml/dispatches`, {}), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, /synthetic-token|sensitive remote/);
    return true;
  });
});

test("workflow wiring guards before classification and keeps main failure observation", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci-gates.yml", import.meta.url), "utf8");
  const monitor = readFileSync(new URL("../../.github/workflows/main-ci-failure-alert.yml", import.meta.url), "utf8");
  assert.match(ci, /workflow_dispatch:/);
  assert.doesNotMatch(ci, /^run-name:/m, "the existing observer routes by stable workflow name");
  assert.ok(ci.indexOf("Validate dispatched main revision") < ci.indexOf("Classify changed paths"));
  assert.match(ci, /CI_DIFF_BASE: \$\{\{ inputs\.base_sha \|\|/);
  assert.match(ci, /node --test scripts\/ci\/dispatch-main-ci\.test\.mjs/);
  const job = monitor.split("  dispatch-primary:")[1].split("  main-ci:")[0];
  assert.match(job, /actions: write/);
  assert.match(job, /contents: read/);
  assert.match(job, /ref: main/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /cancel-in-progress: false/);
  assert.match(job, /workflow_run\.event == 'pull_request'/);
  assert.match(monitor, /workflow_run\.head_branch == 'main'.*workflow_run\.name == 'CI — segment gates'/);
});
