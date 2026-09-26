import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDeploy, initialState, reduceObservation, renderIncident, validateState,
  planRunAudit, reduceRunAudit, reconcileEffects, replayLifecycle, finalizeReplay,
  createGithubAdapter, collectProvider, normalizeRun,
} from "./netlify-production-failure-alert.mjs";

// These fixtures are synthetic. No test performs provider or GitHub network I/O.
const SITE = "be2bb95e-ba70-47f8-8d2d-70cd37b9b41a";
const REPOSITORY = "example/haven";
const SHA = "a".repeat(40);
const NOW = "2026-09-21T12:00:00.000Z";
const BEFORE = "2026-09-21T10:00:00.000Z";
const id = (n) => n.toString(16).padStart(24, "0");
const iso = (minutes) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const clone = (value) => structuredClone(value);
const commit = { sha: SHA, exists: true, onMain: true, message: "Synthetic ordinary commit" };
const baseline = {
  id: id(1), site_id: SITE, context: "production", branch: "main", commit_ref: SHA,
  state: "ready", draft: false, created_at: BEFORE, updated_at: iso(-110), published_at: iso(-110),
};
const site = (published = baseline) => ({ id: SITE, name: "circleoflifealf", admin_url: "https://app.netlify.com/projects/circleoflifealf", published_deploy: published });
function raw(overrides = {}) {
  return { ...baseline, id: id(2), state: "error", created_at: iso(-20), updated_at: iso(-10), published_at: null, ...overrides };
}
function classify(record, options = {}) {
  return classifyDeploy(record, { site: site(), commit, now: NOW, ...options });
}
function state(overrides = {}) {
  return { ...initialState({ now: BEFORE, repository: REPOSITORY, siteId: SITE }), ...overrides };
}
function scan(saved, deploys, options = {}) {
  return reduceObservation(saved, { deploys, site: site(), now: NOW, complete: true, ...options });
}
function ready(overrides = {}) {
  const record = raw({ id: id(4), state: "ready", created_at: iso(-5), updated_at: iso(-1), published_at: iso(-1), ...overrides });
  return { record, event: classify(record, { site: site(record) }) };
}

test("CL01/CL09: a verified historical main SHA remains a production failure", () => {
  const result = classify(raw());
  assert.equal(result.kind, "failure");
  assert.equal(result.id, id(2));
  assert.equal(result.sha, SHA);
  assert.equal(result.providerUpdatedAt, iso(-10));
  assert.equal(result.exactFailureTimeAvailable, false);
  assert.equal(result.firstObservedTerminalAt, NOW);
});

test("CL02–CL04: explicit exclusions cannot become production incidents", () => {
  for (const patch of [
    { context: "deploy-preview" }, { context: "branch-deploy" }, { branch: "feature/example" },
    { site_id: "00000000-0000-0000-0000-000000000000" }, { draft: true }, { state: "canceled" },
    { state: "skipped" }, { superseded: true },
  ]) {
    const result = classify(raw(patch));
    assert.equal(result.kind, "ignored", JSON.stringify(patch));
    assert.ok(result.reason, "exclusions explain their reason");
  }
  assert.equal(classify(raw(), { commit: { ...commit, message: "Private message [skip netlify]" } }).kind, "ignored");
});

test("CL05: building and queued attempts remain pending", () => {
  for (const providerState of ["new", "pending", "building", "enqueued", "processing"]) {
    assert.equal(classify(raw({ state: providerState })).kind, "pending", providerState);
  }
});

test("CL06–CL08/CL10: incomplete identities, commit proof, and timestamps fail closed", () => {
  for (const patch of [
    { id: null }, { id: "../unsafe" }, { commit_ref: "abc123" }, { commit_ref: "z".repeat(40) },
    { site_id: undefined }, { context: undefined }, { branch: undefined }, { state: undefined },
    { state: "unknown-new-state" }, { created_at: undefined }, { updated_at: "yesterday" },
    { created_at: "2026-09-21T11:00:00" }, { updated_at: iso(6) }, { updated_at: iso(-30) },
  ]) {
    assert.equal(classify(raw(patch)).kind, "invalid", JSON.stringify(patch));
  }
  for (const patch of [{ exists: false }, { onMain: false }, { message: undefined }, { sha: "b".repeat(40) }, { error: "lookup unavailable" }]) {
    assert.equal(classify(raw(), { commit: { ...commit, ...patch } }).kind, "invalid", JSON.stringify(patch));
  }
});

test("CL12/CH08: publication needs matching site identity and valid normalized time", () => {
  assert.notEqual(classify(raw({ state: "ready" })).kind, "published");
  const r = ready({ published_at: "2026-09-21T07:59:00-04:00" });
  assert.equal(r.event.kind, "published");
  assert.equal(r.event.publishedAt, iso(-1));
  assert.notEqual(classify(r.record).kind, "published", "ready but not the site's publication cannot recover");
  assert.equal(classify(raw(), { site: { ...site(), id: "other-site" } }).kind, "invalid");
});

test("EV01/EV02/EV05: counts are distinct deploy attempts, including retries of one SHA", () => {
  const first = scan(state(), [classify(raw())]);
  assert.deepEqual(first.state.failureIds, [id(2)]);
  assert.equal(first.effects.filter((effect) => effect.type === "failure").length, 1);
  const duplicate = scan(first.state, [classify(raw({ updated_at: iso(-1) }))]);
  assert.deepEqual(duplicate.state.failureIds, [id(2)]);
  assert.equal(duplicate.effects.length, 0);
  const second = scan(duplicate.state, [classify(raw({ id: id(3) }))]);
  assert.deepEqual(second.state.failureIds, [id(2), id(3)]);
  assert.match(renderIncident(second.state).title, /repeated|2/i);
});

test("EV03/EV04/CH04: same-scan publication never erases an uncertain-time failure", () => {
  const r = ready();
  const result = scan(state(), [r.event, classify(raw({ id: id(3) })), classify(raw())], { site: site(r.record) });
  assert.equal(result.state.phase, "incident");
  assert.equal(result.state.failureIds.length, 2);
  assert.deepEqual(result.effects.map((effect) => effect.type), ["failure", "failure"]);
  assert.equal(result.effects.some((effect) => effect.type === "recovery"), false);
});

test("CH01/CH05: publication after first-observed failure permits a later recovery", () => {
  const failed = scan(state(), [classify(raw())]);
  const r = ready({ created_at: iso(1), updated_at: iso(2), published_at: iso(2) });
  const event = classify(r.record, { site: site(r.record), now: iso(3) });
  const result = scan(failed.state, [event], { site: site(r.record), now: iso(3) });
  assert.deepEqual(result.effects.map((effect) => effect.type), ["recovery"]);
  assert.equal(result.effects[0].deployId, r.record.id);
});

test("CH02/CL11: older generations, equal-time attempts, and incomplete scans cannot close", () => {
  const failed = scan(state(), [classify(raw())]);
  for (const created_at of [BEFORE, iso(-20)]) {
    const r = ready({ created_at, updated_at: iso(2), published_at: iso(2) });
    const event = classify(r.record, { site: site(r.record), now: iso(3) });
    const result = scan(failed.state, [event], { site: site(r.record), now: iso(3) });
    assert.equal(result.state.phase, "incident");
    assert.equal(result.effects.some((effect) => effect.type === "recovery"), false);
  }
  const incomplete = scan(failed.state, [], { complete: false });
  assert.equal(incomplete.coverageComplete, false);
  assert.equal(incomplete.state.discoveryBoundary, failed.state.discoveryBoundary);
  assert.equal(incomplete.state.lastSuccessfulObservationAt, failed.state.lastSuccessfulObservationAt);
});

test("EV06/BS01/BS02: bootstrap retains old pending attempts and routes their later failure", () => {
  const pending = classify(raw({ id: id(5), state: "building", created_at: "2026-08-01T00:00:00Z", updated_at: iso(-1) }));
  const boot = scan(state(), [classify(baseline), pending, classify(raw({ created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:01:00Z" }))], { bootstrap: true });
  assert.equal(boot.state.failureIds.length, 0);
  assert.ok(boot.state.pendingDeploys.some((entry) => entry.id === id(5)));
  const later = classify(raw({ id: id(5), created_at: "2026-08-01T00:00:00Z", updated_at: NOW }));
  const result = scan(boot.state, [later]);
  assert.deepEqual(result.state.failureIds, [id(5)]);
  assert.equal(result.effects.filter((effect) => effect.type === "failure").length, 1);
});

test("BS03/BS04: missing publication or incomplete bootstrap cannot initialize healthy state", () => {
  for (const options of [{ site: { id: SITE } }, { complete: false }]) {
    const original = state();
    const result = scan(original, [classify(baseline)], { bootstrap: true, ...options });
    assert.equal(result.coverageComplete, false);
    assert.equal(result.state.discoveryBoundary, original.discoveryBoundary);
    assert.notEqual(result.state.phase, "healthy");
  }
});

test("ST06: identical page duplicates dedupe but conflicting records preserve checkpoint", () => {
  const failure = classify(raw());
  assert.equal(scan(state(), [failure, clone(failure)]).state.failureIds.length, 1);
  const original = state();
  const result = scan(original, [failure, { ...failure, sha: "b".repeat(40) }]);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.state.discoveryBoundary, original.discoveryBoundary);
});

test("ST01/ST03: incompatible, oversized, and overflowing owned state requires repair", () => {
  for (const value of [null, {}, state({ schemaVersion: 999 }), state({ repository: "wrong/repo" }),
    state({ pendingDeploys: Array.from({ length: 201 }, (_, n) => ({ id: id(n + 50), firstObservedAt: BEFORE })) }),
    state({ failureIds: Array.from({ length: 201 }, (_, n) => id(n + 50)) }),
    state({ extra: "x".repeat(32769) }),
  ]) assert.throws(() => validateState(value, { repository: REPOSITORY, siteId: SITE }), /state|repair|bound|schema|identity/i);
});

test("CL14/CL15/SEC01/SEC02: issue payload contains verified facts and no free-form provider text", () => {
  const attack = "UNSAFE_SENTINEL @everyone <script>bad()</script>\nAuthorization: Bearer fake-test-value\u0000 https://user:password@attacker.invalid";
  const failure = classify(raw({ error_message: attack, title: attack, deploy_ssl_url: attack, admin_url: attack, branch_deploy: attack }));
  const rendered = renderIncident(scan(state(), [failure]).state);
  const output = JSON.stringify(rendered);
  assert.doesNotMatch(output, /UNSAFE_SENTINEL|attacker\.invalid|@everyone|Bearer|<script>/);
  assert.match(output, new RegExp(SHA));
  assert.match(output, new RegExp(id(2)));
  assert.match(output, /stage unavailable/i);
  assert.match(output, /exact failure time unavailable|exact failure time.*unavailable/i);
  assert.match(output, /inspect.*deploy log/i);
  assert.match(output, /https:\/\/app\.netlify\.com\//);
  assert.doesNotMatch(output, /\bHTTP[ \t]+(?:is[ \t]+)?(?:healthy|available)\b/i, "publication is not an HTTP availability check");
});

// The in-memory adapter exposes readback independently from each write so the
// real reconciler must survive uncertain responses rather than count API calls.
function githubFixture({ failAt, accepted = true } = {}) {
  let saved = null;
  let issue = null;
  let crashed = false;
  const calls = [];
  const comments = [];
  const perform = async (name, mutation) => {
    calls.push(name);
    if (name === failAt && !crashed) {
      crashed = true;
      if (accepted) mutation();
      throw new Error("synthetic uncertain response");
    }
    return mutation();
  };
  const adapter = {
    clock: () => NOW,
    load: async () => clone(saved),
    save: (value) => perform("save", () => { saved = clone(value); return clone(saved); }),
    findIssue: async () => clone(issue),
    createIssue: (value) => perform("createIssue", () => { issue = { number: 42, state: "open", assignees: [], labels: [], ...clone(value) }; return clone(issue); }),
    getIssue: async () => clone(issue),
    updateIssue: (_number, patch) => perform("updateIssue", () => { Object.assign(issue, clone(patch)); return clone(issue); }),
    listComments: async () => clone(comments),
    createComment: (_number, value) => perform("createComment", () => { const comment = { id: comments.length + 1, ...clone(value) }; comments.push(comment); return clone(comment); }),
    validatePublication: async () => true,
  };
  return { adapter, calls, comments, get issue() { return issue; }, get saved() { return saved; } };
}

test("TX01/TX02/BS06: uncertain create/comment/state writes converge without duplicated effects", async () => {
  for (const failAt of ["createIssue", "save", "updateIssue", "createComment"]) {
    for (const accepted of [true, false]) {
      const fixture = githubFixture({ failAt, accepted });
      const plan = scan(state(), [classify(raw())]);
      await reconcileEffects(plan, fixture.adapter).catch(() => {});
      const result = await reconcileEffects(plan, fixture.adapter);
      assert.equal(result.deliveryComplete, true, `${failAt}/${accepted}`);
      assert.equal(fixture.issue.number, 42);
      assert.equal(fixture.issue.state, "open");
      assert.ok(fixture.issue.assignees.some((entry) => (entry.login ?? entry) === "example"));
      assert.equal(fixture.comments.filter((entry) => entry.body.includes(`failure:${id(2)}`)).length, 1);
      assert.equal(fixture.saved.deliveryComplete, true);
      assert.equal(fixture.calls.some((name) => name.includes("health")), false);
    }
  }
});

test("TX04/OBS01: write acceptance without assigned readback cannot claim completed routing", async () => {
  const fixture = githubFixture();
  fixture.adapter.getIssue = async () => ({ ...clone(fixture.issue), assignees: [] });
  await assert.rejects(() => reconcileEffects(scan(state(), [classify(raw())]), fixture.adapter), /assign|readback|delivery/i);
  assert.notEqual(fixture.saved?.deliveryComplete, true);
  assert.equal(fixture.saved?.assignmentConfirmedAt ?? null, null);
});

test("TX03/ST02: retry finds marked evidence and preserves human text while reopening", async () => {
  const fixture = githubFixture();
  const plan = scan(state(), [classify(raw())]);
  await reconcileEffects(plan, fixture.adapter);
  await fixture.adapter.updateIssue(42, { body: `${fixture.issue.body}\n\nHuman note: investigate DNS separately.`, state: "closed" });
  fixture.comments.unshift(...Array.from({ length: 110 }, (_, index) => ({ id: 500 + index, body: `Unrelated comment ${index}` })));
  await reconcileEffects(plan, fixture.adapter);
  assert.equal(fixture.issue.state, "open");
  assert.match(fixture.issue.body, /Human note: investigate DNS separately\./);
  assert.equal(fixture.comments.filter((comment) => comment.body.includes(`failure:${id(2)}`)).length, 1);
});

test("CH06/TX05: a changed publication invalidates prepared closure", async () => {
  const fixture = githubFixture();
  const first = scan(state(), [classify(raw())]);
  await reconcileEffects(first, fixture.adapter);
  const r = ready({ created_at: iso(1), updated_at: iso(2), published_at: iso(2) });
  const recovery = scan(first.state, [classify(r.record, { site: site(r.record), now: iso(3) })], { site: site(r.record), now: iso(3) });
  assert.equal(recovery.effects.some((effect) => effect.type === "recovery"), true);
  fixture.adapter.validatePublication = async () => false;
  await reconcileEffects(recovery, fixture.adapter).catch(() => {});
  assert.equal(fixture.issue.state, "open");
  assert.notEqual(fixture.saved?.phase, "healthy");
});

const sources = ["observer", "main-ci"];
function run(source, overrides = {}) {
  return {
    id: 100, run_attempt: 1, workflow_id: source === "observer" ? 10 : 20,
    repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, head_branch: "main", head_sha: SHA,
    path: source === "observer" ? ".github/workflows/netlify-production-failure-alert.yml" : ".github/workflows/ci-gates.yml",
    event: source === "observer" ? "schedule" : "push", status: "completed", conclusion: "failure",
    created_at: iso(-5), run_started_at: iso(-4), updated_at: iso(-3),
    html_url: `https://github.com/${REPOSITORY}/actions/runs/100`, ...overrides,
  };
}
function audit(saved, source, runs, options = {}) {
  return reduceRunAudit(saved, { source, workflowId: source === "observer" ? 10 : 20, repository: REPOSITORY,
    runs, attempts: [], events: [], now: NOW, complete: true, auditComplete: true, ...options });
}

for (const source of sources) {
  test(`HL03/HL07/BK04 (${source}): trusted failed attempt routes once even without a result`, () => {
    const first = audit(state(), source, [run(source)]);
    assert.equal(first.effects.filter((effect) => effect.type === "failure").length, 1);
    assert.match(first.effects[0].key, /100:1$/);
    const repeated = audit(first.state, source, [run(source)]);
    assert.equal(repeated.effects.length, 0);
  });

  test(`BK01/BK02/RR06 (${source}): unfinished runs survive both overlap and audit windows`, () => {
    const pending = run(source, { status: "in_progress", conclusion: null, created_at: "2026-08-01T00:00:00Z" });
    const first = audit(state(), source, [pending]);
    const plan = planRunAudit(first.state, { source, now: NOW });
    assert.ok(plan.pendingRunIds.includes(100));
    for (const query of plan.queries) {
      assert.equal(Object.hasOwn(query, "status"), false);
      assert.equal(Object.hasOwn(query, "conclusion"), false);
      assert.equal(query.per_page, 100);
      assert.ok(query.created);
    }
    const finished = audit(first.state, source, [{ ...pending, status: "completed", conclusion: "failure", updated_at: iso(-1) }]);
    assert.equal(finished.effects.filter((effect) => effect.type === "failure").length, 1);
  });

  test(`BK08 (${source}): latest success cannot erase failed prior attempts`, () => {
    const latest = run(source, { run_attempt: 3, conclusion: "success", updated_at: iso(-1) });
    const attempts = [run(source), run(source, { run_attempt: 2, updated_at: iso(-2) }), latest];
    const result = audit(state(), source, [latest], { attempts });
    assert.equal(result.effects.filter((effect) => effect.type === "failure").length, 2);
    assert.equal(new Set(result.effects.map((effect) => effect.key)).size, result.effects.length);
    const missing = audit(state(), source, [latest], { attempts: [latest] });
    assert.equal(missing.coverageComplete, false);
    assert.equal(missing.effects.some((effect) => effect.type === "recovery"), false);
  });

  test(`RR01/RR02 (${source}): an old consumed run's new failure survives old recovery and repeat delivery`, () => {
    const old = run(source, { conclusion: "success", created_at: "2026-09-16T12:00:00Z", updated_at: "2026-09-16T12:05:00Z" });
    const original = audit(state(), source, [old]);
    const rerun = { ...old, run_attempt: 2, conclusion: "failure", run_started_at: iso(-4), updated_at: iso(-2) };
    const discovered = audit(original.state, source, [rerun], { attempts: [old, rerun] });
    assert.equal(discovered.effects.filter((effect) => effect.type === "failure").length, 1);
    assert.match(discovered.effects.find((effect) => effect.type === "failure").key, /100:2$/);
    const repeated = audit(discovered.state, source, [old, rerun], { attempts: [old, rerun] });
    assert.equal(repeated.effects.length, 0);
  });

  test(`BK06/RR05 (${source}): incomplete ranges never commit or recover`, () => {
    const original = audit(state(), source, [run(source)]).state;
    for (const reason of ["page-error", "page-limit", "request-limit", "retention-gap", "missing-attempt", "boundary-lost"]) {
      const result = audit(original, source, [run(source, { id: 101, conclusion: "success" })], { complete: false, reason });
      assert.equal(result.coverageComplete, false, reason);
      assert.equal(result.effects.some((effect) => effect.type === "recovery"), false, reason);
      assert.deepEqual(result.state.audit?.[source]?.boundary, original.audit?.[source]?.boundary);
    }
  });

  test(`RR01/RR03/RR07 (${source}): ten healthy ticks cover 30 distinct older day shards`, () => {
    let current = state();
    const intervals = [];
    for (let tick = 0; tick < 10; tick += 1) {
      const now = iso(tick * 5);
      const planned = planRunAudit(current, { source, now });
      assert.equal(planned.shards.length, 3);
      assert.equal(planned.maxRequests, 50);
      assert.equal(planned.maxPagesPerPartition, 10);
      intervals.push(...planned.shards.map((shard) => `${shard.from}/${shard.to}`));
      current = audit(current, source, [], { now, completedShards: planned.shards, auditComplete: tick === 9 }).state;
    }
    assert.equal(new Set(intervals).size, 30);
    const parsed = intervals.map((value) => value.split("/").map(Date.parse));
    assert.equal(Math.max(...parsed.map((value) => value[1])) - Math.min(...parsed.map((value) => value[0])), 30 * 86400_000);
    const late = audit(current, source, [], { now: iso(120), auditComplete: false });
    assert.equal(late.coverageComplete, false, "missed schedules cannot manufacture recent full-audit proof");
  });
}

test("HL05/HL06/BK10: late old success and other sources cannot clear a newer observer fault", () => {
  const failed = audit(state(), "observer", [run("observer")]);
  for (const recovery of [run("main-ci", { conclusion: "success" }), run("observer", { id: 99, conclusion: "success", updated_at: iso(-10) })]) {
    const result = audit(failed.state, "observer", [recovery]);
    assert.equal(result.effects.some((effect) => effect.type === "recovery"), false);
  }
});

test("HL08: unproved dispatch mode and arbitrary run names cannot suppress startup failures", () => {
  const ambiguous = run("observer", { event: "workflow_dispatch", conclusion: "startup_failure", display_title: "replay" });
  const result = audit(state(), "observer", [ambiguous]);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.effects.some((effect) => effect.type === "recovery"), false);
});

test("COL-870: primary dispatch failure and success reach the existing main CI observer", () => {
  const options = { source: "main-ci", workflowId: 20, repository: REPOSITORY, now: NOW };
  const failed = run("main-ci", { event: "workflow_dispatch" });
  assert.equal(normalizeRun(failed, options), failed, "raw API attempt needs no provider-observer mode");
  const failure = audit(state(), "main-ci", [failed]);
  assert.equal(failure.effects.filter((e) => e.type === "failure").length, 1);
  const success = run("main-ci", { id: 101, event: "workflow_dispatch", conclusion: "success", updated_at: iso(-1) });
  assert.equal(normalizeRun(success, options), success);
  const recovery = audit(failure.state, "main-ci", [failed, success]);
  assert.equal(recovery.coverageComplete, true);
  assert.equal(recovery.effects.some((e) => e.type === "recovery"), true);
  for (const invalid of [{ head_branch: "feature" }, { head_repository: { full_name: "fork/repo" } }, { workflow_id: 10 }, { path: ".github/workflows/netlify-production-failure-alert.yml" }]) {
    assert.equal(normalizeRun({ ...failed, ...invalid }, options), null);
  }
});

test("SEC04/RP01–RP04: finite replay uses the routing adapter without touching a live provider", async () => {
  const fixture = githubFixture();
  let providerCalls = 0;
  const result = await replayLifecycle({ adapter: fixture.adapter, runId: "987654", now: NOW,
    provider: () => { providerCalls += 1; throw new Error("replay must not call provider"); } });
  assert.equal(providerCalls, 0);
  assert.equal(result.success, true);
  assert.deepEqual(result.counts, [1, 1, 2]);
  assert.equal(result.previewIgnored, true);
  assert.match(fixture.issue.title, /^\[SYNTHETIC\]/);
  assert.match(fixture.issue.body, /987654/);
  assert.equal(fixture.issue.state, "closed");
  assert.equal(fixture.comments.filter((value) => value.body.includes("failure:")).length, 2);
  assert.equal(fixture.comments.filter((value) => value.body.includes(":preview-ignore -->")).length, 1);
  assert.ok(fixture.comments.some((value) => value.body.includes("recovery:")));
});

test("RP05/RP07: replay failure cleanup is not recovery and cannot close an operational issue", async () => {
  const fixture = githubFixture();
  await fixture.adapter.createIssue({ title: "Production incident", body: "<!-- haven-netlify-production-alert -->", state: "open" });
  const before = clone(fixture.issue);
  await finalizeReplay({ adapter: fixture.adapter, runId: "987654", outcome: "failure" });
  assert.deepEqual(fixture.issue, before);
  assert.equal(fixture.comments.length, 0);
});

test("review: skipped flag excludes errors and current ready publication", () => {
  assert.equal(classify(raw({ skipped: true })).kind, "ignored");
  const r = ready({ skipped: true });
  assert.equal(r.event.kind, "ignored");
});

test("review: fixed stage signatures and complete incident/recovery diagnostics", async () => {
  const failure = classify(raw({ error_message: "Failed during stage 'building site': private secret detail" }), { commit: { ...commit, message: "Fix production build\nprivate body" } });
  const saved = state({ phase: "healthy", publication: classify(baseline) });
  const plan = scan(saved, [failure]);
  const rendered = renderIncident(plan.state);
  assert.match(rendered.body, /Stage: build/);
  assert.match(rendered.body, /Subject: Fix production build/);
  assert.match(rendered.body, /Provider state: error/);
  assert.match(rendered.body, /Repository: example\/haven/);
  assert.match(rendered.body, new RegExp(`Site: ${SITE}`));
  assert.match(rendered.body, /https:\/\/app\.netlify\.com\/projects\/circleoflifealf\/deploys\//);
  assert.match(rendered.body, new RegExp(`Previous provider publication: deploy ${baseline.id}`));
  assert.doesNotMatch(rendered.body, /private secret detail|private body/);
  const fixture = githubFixture();
  const routed = await reconcileEffects(plan, fixture.adapter);
  const r = ready({ created_at: iso(1), updated_at: iso(2), published_at: iso(2) });
  await reconcileEffects(scan(routed.state, [classify(r.record, { site: site(r.record), now: iso(3) })], { site: site(r.record), now: iso(3) }), fixture.adapter);
  const comment = fixture.comments.find((entry) => entry.body.includes(":effect:recovery:"));
  assert.match(comment.body, new RegExp(SHA));
  assert.match(comment.body, new RegExp(r.record.id));
  assert.match(comment.body, new RegExp(iso(2).replaceAll(".", "\\.")));
  assert.match(comment.body, /Production: https:\/\/circleoflifealf\.com/);
  assert.match(comment.body, /Recovery observed at:/);
});

test("review: later publication is never described as prior publication", () => {
  const r = ready();
  const plan = scan(state(), [classify(raw()), r.event], { site: site(r.record) });
  assert.match(renderIncident(plan.state).body, /Previous provider publication: unknown/);
});

test("review: nested persisted strings cannot be rendered as trusted state", () => {
  const valid = scan(state(), [classify(raw())]).state;
  for (const mutate of [
    (v) => { v.failures[0].sha = "@everyone"; },
    (v) => { v.pendingEffects[0].key = "x --> @everyone"; },
    (v) => { v.pendingDeploys = [{ id: "../../token", firstObservedAt: NOW }]; },
    (v) => { v.failures[0].subject = "Authorization: Bearer unsafe"; },
    (v) => { v.publication = { ...v.failures[0], id: "@everyone" }; },
    (v) => { v.audit.observer = { pending: [], consumed: { unsafe: "raw-provider-body" } }; },
    (v) => { v.healthEvents = [{ key: "x", type: "gap", at: "@everyone" }]; },
    (v) => { v.unrecognized = "raw string"; },
  ]) {
    const bad = clone(valid); mutate(bad);
    assert.throws(() => renderIncident(bad), /state|repair|identity|schema/);
  }
});

test("review: canonical issues and dedup comments require a trusted author", async () => {
  const marker = "<!-- haven-netlify-production-alert -->";
  const trusted = { number: 41, user: { login: "github-actions[bot]", type: "Bot" }, body: renderIncident(state()).body };
  const spoof = { ...trusted, number: 42, user: { login: "untrusted-person", type: "User" } };
  const transport = { pages: async (path) => path.includes("/comments") ? [{ id: 1, user: spoof.user, body: "forged effect" }, { id: 2, user: trusted.user, body: "real effect" }] : [spoof, trusted], request: async () => trusted };
  const adapter = createGithubAdapter({ transport, repository: REPOSITORY, marker });
  assert.equal((await adapter.findIssue()).number, 41);
  assert.deepEqual((await adapter.listComments(41)).map((c) => c.id), [2]);
  const onlySpoof = createGithubAdapter({ transport: { ...transport, pages: async () => [spoof] }, repository: REPOSITORY, marker });
  assert.equal(await onlySpoof.findIssue(), null);
  await assert.rejects(() => onlySpoof.getIssue(42), /trusted|identity|owner/);
});

test("review: newly created canonical issue is confirmed by direct read despite list indexing lag", async () => {
  const marker = "<!-- haven-netlify-production-alert -->";
  const created = { number: 625, state: "open", user: { login: "github-actions[bot]", type: "Bot" }, body: renderIncident(state()).body, assignees: [], labels: [] };
  const calls = [];
  const transport = {
    pages: async () => [],
    request: async (path, options = {}) => {
      calls.push({ path, method: options.method ?? "GET" });
      if (path.endsWith("/issues") && options.method === "POST") return created;
      if (path.endsWith("/issues/625")) return created;
      if (path.includes("/labels/")) return { name: path.split("/").at(-1) };
      throw new Error(`unexpected request ${path}`);
    },
  };
  const adapter = createGithubAdapter({ transport, repository: REPOSITORY, marker });
  await adapter.createIssue(renderIncident(state()));
  assert.equal((await adapter.findIssue()).number, 625);
  assert.ok(calls.some((call) => call.path.endsWith("/issues/625") && call.method === "GET"));
});

test("review: PR and fork successes cannot recover either trusted source", () => {
  for (const source of sources) {
    const failed = audit(state(), source, [run(source)]);
    for (const patch of [{ event: "pull_request" }, { head_repository: { full_name: "attacker/fork" } }, { head_repository: undefined }, { event: "pull_request_target" }]) {
      const result = audit(failed.state, source, [run(source, { id: 200, conclusion: "success", updated_at: iso(-1), observationComplete: true, ...patch })]);
      assert.equal(result.effects.some((e) => e.type === "recovery"), false);
    }
  }
});

test("review: stale full-audit age blocks recovery but allows shard progress to converge", () => {
  let current = audit(state(), "observer", [run("observer")]).state;
  for (let tick = 0; tick < 10; tick++) {
    const now = iso(120 + tick * 5);
    const plan = planRunAudit(current, { source: "observer", now });
    const result = audit(current, "observer", [], { now, completedShards: plan.shards, auditComplete: tick === 9 });
    assert.equal(result.progressComplete, true);
    assert.equal(result.effects.some((e) => e.type === "recovery"), false);
    current = result.state;
  }
  assert.equal(current.audit.observer.lastFullAuditAt, iso(165));
});

test("review: ledger gap participates in durable chronology and later complete observation recovers", () => {
  const gap = { key: "coverage-gap:1:100:1", type: "gap", at: iso(-5), previousAt: iso(-30), tuple: "100:1", sha: SHA };
  const first = audit(state(), "observer", [], { events: [gap] });
  assert.equal(first.effects.filter((e) => e.type === "failure").length, 1);
  assert.equal(first.state.audit.observer.lastFaultAt, iso(-5));
  const duplicate = audit(first.state, "observer", [], { events: [gap] });
  assert.equal(duplicate.effects.length, 0);
  const recovered = audit(duplicate.state, "observer", [run("observer", { id: 101, conclusion: "success", updated_at: iso(-1), observationComplete: true })]);
  assert.equal(recovered.effects.filter((e) => e.type === "recovery").length, 1);
});

test("review: 501 historical SHAs do not consume verification budget before a new failure", async () => {
  const historical = Array.from({ length: 501 }, (_, n) => raw({ id: id(n + 1000), commit_ref: (n + 1000).toString(16).padStart(40, "0"), state: "ready", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:01:00Z" }));
  const rows = [raw(), baseline, ...historical];
  let providerPages = 0;
  let githubRequests = 0;
  const provider = { request: async (path) => {
    if (path === `/sites/${SITE}`) return site();
    if (path === `/sites/${SITE}/deploys/${baseline.id}`) return baseline;
    const url = new URL(`https://provider.invalid${path}`);
    if (url.pathname === `/sites/${SITE}/deploys`) {
      providerPages++;
      const page = Number(url.searchParams.get("page"));
      return rows.slice((page - 1) * 100, page * 100);
    }
    throw new Error("unexpected provider request");
  } };
  const github = { request: async (path) => {
    githubRequests++;
    assert.ok(githubRequests < 10, "historical commit verification must not exhaust the request budget");
    return path.includes("/compare/") ? { status: "ahead", base_commit: { sha: SHA } } : { sha: SHA, commit: { message: "Ordinary verified subject" } };
  } };
  const existing = state({ discoveryBoundary: iso(-30), discoveryAnchorId: baseline.id, phase: "healthy", publication: classify(baseline) });
  const observation = await collectProvider({ provider, github, state: existing, now: NOW, repository: REPOSITORY });
  assert.equal(observation.complete, true);
  assert.equal(observation.deploys.filter((e) => e.kind === "failure").length, 1);
  assert.equal(providerPages, 1);
  assert.ok(githubRequests <= 4);
  providerPages = 0;
  githubRequests = 0;
  const boot = await collectProvider({ provider, github, state: state(), now: NOW, repository: REPOSITORY });
  assert.equal(boot.complete, true);
  assert.equal(providerPages, 1, "bootstrap stops at the current published baseline instead of rate-limiting on lifetime history");
  assert.ok(githubRequests <= 4, "bootstrap does not verify 501 recovered historical SHAs");
});

test("review: incremental discovery directly revisits pending attempts older than its boundary", async () => {
  const pendingId = id(900);
  const saved = state({ discoveryBoundary: iso(-30), discoveryAnchorId: baseline.id, phase: "healthy", publication: classify(baseline), pendingDeploys: [{ id: pendingId, firstObservedAt: "2026-08-01T00:00:00Z" }] });
  const requested = [];
  const provider = { request: async (path) => {
    requested.push(path);
    if (path === `/sites/${SITE}`) return site();
    if (path === `/sites/${SITE}/deploys/${baseline.id}`) return baseline;
    if (path === `/sites/${SITE}/deploys/${pendingId}`) return raw({ id: pendingId, created_at: "2026-08-01T00:00:00Z" });
    return [baseline];
  } };
  const github = { request: async (path) => path.includes("/compare/") ? { status: "ahead", base_commit: { sha: SHA } } : { sha: SHA, commit: { message: "Verified main commit" } } };
  const result = await collectProvider({ provider, github, state: saved, now: NOW, repository: REPOSITORY });
  assert.ok(requested.includes(`/sites/${SITE}/deploys/${pendingId}`));
  assert.equal(result.deploys.find((event) => event.id === pendingId).kind, "failure");
  assert.deepEqual(scan(saved, result.deploys).state.failureIds, [pendingId]);
});

test("review: delayed schedule still processes every deploy newer than the retained anchor", async () => {
  const delayed = raw({ id: id(901), created_at: iso(-20), updated_at: iso(-19) });
  const saved = state({ discoveryBoundary: iso(-30), discoveryAnchorId: baseline.id, phase: "healthy", publication: classify(baseline) });
  const provider = { request: async (path) => {
    if (path === `/sites/${SITE}`) return site();
    if (path === `/sites/${SITE}/deploys/${baseline.id}`) return baseline;
    return [delayed, baseline];
  } };
  const github = { request: async (path) => path.includes("/compare/")
    ? { status: "ahead", base_commit: { sha: SHA } }
    : { sha: SHA, commit: { message: "Delayed but verified main commit" } } };
  const result = await collectProvider({ provider, github, state: saved, now: NOW, repository: REPOSITORY });
  assert.equal(result.deploys.find((event) => event.id === delayed.id)?.kind, "failure");
  assert.deepEqual(scan(saved, result.deploys).state.failureIds, [delayed.id]);
});

test("review: bootstrap exclusions prevent a recovered historical failure reopening on the next poll", async () => {
  const oldFailure = raw({ id: id(902), created_at: "2026-09-21T09:00:00Z", updated_at: "2026-09-21T09:01:00Z" });
  const rows = [baseline, oldFailure];
  const provider = { request: async (path) => {
    if (path === `/sites/${SITE}`) return site();
    if (path === `/sites/${SITE}/deploys/${baseline.id}`) return baseline;
    return rows;
  } };
  let githubRequests = 0;
  const github = { request: async (path) => {
    githubRequests++;
    assert.ok(githubRequests <= 4, "only the published baseline may need verification across both scans");
    return path.includes("/compare/")
      ? { status: "ahead", base_commit: { sha: SHA } }
      : { sha: SHA, commit: { message: "Verified published baseline" } };
  } };
  const firstObservation = await collectProvider({ provider, github, state: state(), now: NOW, repository: REPOSITORY });
  const boot = scan(state(), firstObservation.deploys, { bootstrap: true });
  assert.equal(boot.state.phase, "healthy");
  assert.deepEqual(boot.state.historicalExcludedIds, [oldFailure.id]);

  const saved = { ...boot.state, discoveryBoundary: NOW, discoveryAnchorId: baseline.id };
  const secondObservation = await collectProvider({ provider, github, state: saved, now: iso(5), repository: REPOSITORY });
  const next = scan(saved, secondObservation.deploys, { now: iso(5) });
  assert.equal(next.state.phase, "healthy");
  assert.deepEqual(next.state.failureIds, []);
  assert.equal(next.effects.length, 0);
});

test("review: endpoint identity and unsafe commit subjects fail closed without unsafe output", () => {
  for (const patch of [{ name: "other-site" }, { admin_url: "https://attacker.invalid/path" }, { admin_url: "https://app.netlify.com/projects/other" }]) {
    assert.equal(classify(raw(), { site: { ...site(), ...patch } }).kind, "invalid");
  }
  const failure = classify(raw(), { commit: { ...commit, message: "Authorization: Bearer UNSAFE_SECRET_SENTINEL\nsecond line" } });
  assert.equal(failure.kind, "failure");
  const rendered = renderIncident(scan(state(), [failure]).state);
  assert.match(rendered.body, /Subject: Commit subject withheld/);
  assert.doesNotMatch(JSON.stringify(rendered), /UNSAFE_SECRET_SENTINEL|Bearer|second line/);
});

test("review: stale shards cannot mint a fresh full audit by finishing only the last partition", () => {
  let current = state();
  for (let tick = 0; tick < 9; tick++) {
    const now = iso(tick * 5);
    const plan = planRunAudit(current, { source: "observer", now });
    current = audit(current, "observer", [], { now, completedShards: plan.shards, auditComplete: false }).state;
  }
  const now = iso(120);
  const planned = planRunAudit(current, { source: "observer", now });
  const result = audit(current, "observer", [], { now, completedShards: planned.shards, auditComplete: true });
  assert.equal(result.progressComplete, true);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.state.audit.observer.lastFullAuditAt, null);
});
