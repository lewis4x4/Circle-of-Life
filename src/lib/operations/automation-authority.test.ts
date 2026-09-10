import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ts = createRequire(`${process.cwd()}/package.json`)("typescript") as typeof import("typescript");
type Row = Record<string, unknown>;
type Surface = "oce-escalation-scanner" | "oce-staffing-adequacy-computer" | "risk-nightly-scorer";
const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const OTHER_SITE = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-09-10";
const secrets: Record<Surface, string> = {
  "oce-escalation-scanner": "OCE_ESCALATION_SCANNER_SECRET",
  "oce-staffing-adequacy-computer": "OCE_STAFFING_ADEQUACY_SECRET",
  "risk-nightly-scorer": "RISK_NIGHTLY_SCORER_SECRET",
};
const task = (overrides: Row = {}): Row => ({ id: "permitted-task", organization_id: ORG, facility_id: SITE,
  authority_class: "facility", subject_id: "current-subject", completion_evidence_paths: [],
  status: "pending", priority: "normal", estimated_minutes: 20, assigned_shift_date: DATE, assigned_shift: "day",
  due_at: "2099-01-01T00:00:00Z", license_threatening: false, ...overrides });

function harness(surface: Surface, options: { tables?: Record<string, Row[]>; failTable?: string; truncateTasks?: boolean; automationExcludedIds?: string[] } = {}) {
  let handler: (request: Request) => Response | Promise<Response>;
  const provider = vi.fn(() => { throw new Error("Unexpected provider request"); });
  const writes: Array<{ table: string; action: string; payload: unknown }> = [];
  const tables: Record<string, Row[]> = {
    organizations: [{ id: ORG, status: "active" }],
    facilities: [{ id: SITE, organization_id: ORG, entity_id: null, status: "active", name: "Allowed site", timezone: "America/New_York" }],
    residents: [{ organization_id: ORG, facility_id: SITE, acuity_level: "level_1", status: "active" }],
    staff: [{ id: "staff", organization_id: ORG, facility_id: SITE, staff_role: "nurse", employment_status: "active" }],
    facility_ratio_rules: [{ organization_id: ORG, facility_id: SITE, required_ratio: 0.1 }],
    operation_task_instances: [task()],
    staffing_adequacy_snapshots: [], risk_score_snapshots: [], survey_deficiencies: [], incidents: [],
    resident_safety_scores: [], exec_alerts: [], user_profiles: [],
    ...options.tables,
  };
  const from = vi.fn((table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let head = false;
    let fields = "*";
    let write = false;
    const result = async () => {
      if (write) return { data: { id: "saved-snapshot" }, error: null };
      if (options.failTable === table) return { data: null, count: null, error: { message: "hidden-subject-private-query-detail" } };
      // Emulate the database's safe service projection. SQL probes separately prove
      // its live subject/template-link predicates; these tests prove the handler
      // reads the projection and still reconciles it against the full population.
      const sourceRows = table === "operation_automation_tasks"
        ? (tables.operation_automation_tasks ?? tables.operation_task_instances.filter((row) =>
          row.authority_class === "facility" && row.subject_id != null &&
          (row.completion_evidence_paths == null || (Array.isArray(row.completion_evidence_paths) && row.completion_evidence_paths.length === 0)) &&
          !options.automationExcludedIds?.includes(String(row.id))))
        : (tables[table] ?? []);
      const matching = sourceRows.filter((row) => predicates.every((test) => test(row)));
      const returned = options.truncateTasks && table === "operation_automation_tasks" && !head ? matching.slice(0, 1) : matching;
      return { data: head ? null : returned.map((row) => fields === "*" ? row : Object.fromEntries(fields.split(",").map((key) => [key.trim(), row[key.trim()]]))), count: matching.length, error: null };
    };
    const chain = {
      select(columns: string, config?: { head?: boolean }) { fields = columns; head = config?.head ?? false; return chain; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return chain; },
      is(key: string, value: unknown) { predicates.push((row) => value === null ? row[key] == null : row[key] === value); return chain; },
      not(key: string, _operator: string, value: unknown) { predicates.push((row) => value === null ? row[key] != null : row[key] !== value); return chain; },
      in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return chain; },
      or(expression: string) {
        if (expression.includes("completion_evidence_paths")) predicates.push((row) => row.completion_evidence_paths == null || (Array.isArray(row.completion_evidence_paths) && row.completion_evidence_paths.length === 0));
        return chain;
      },
      gte(key: string, value: string) { predicates.push((row) => String(row[key]) >= value); return chain; },
      order: () => chain,
      upsert(payload: unknown) { write = true; writes.push({ table, action: "upsert", payload }); return chain; },
      insert(payload: unknown) { write = true; writes.push({ table, action: "insert", payload }); return chain; },
      update(payload: unknown) { write = true; writes.push({ table, action: "update", payload }); return chain; },
      async maybeSingle() { const value = await result(); return { ...value, data: Array.isArray(value.data) ? value.data[0] ?? null : value.data }; },
      then(resolve: (value: unknown) => unknown) { return result().then(resolve); },
    };
    return chain;
  });
  const createClient = vi.fn(() => ({ from }));
  const source = readFileSync(`${process.cwd()}/supabase/functions/${surface}/index.ts`, "utf8");
  const compiled = ts.transpileModule(source.replace(/^import .*;\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(compiled, {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => key === secrets[surface] ? "valid-secret" : key } },
    createClient, getCorsHeaders: () => ({}), jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    withTiming: () => ({ log: vi.fn() }), Response, fetch: provider, URLSearchParams, btoa,
  });
  return {
    from, createClient, provider, writes,
    run: (body: unknown = {}, authorized = true) => Promise.resolve(handler!(new Request("https://haven.test/automation", {
      method: "POST", headers: { "x-cron-secret": authorized ? "valid-secret" : "invalid" }, body: JSON.stringify(body),
    }))),
  };
}

function assertNoSideEffects(h: ReturnType<typeof harness>) {
  expect(h.writes).toEqual([]);
  expect(h.provider).not.toHaveBeenCalled();
}
async function assertCoverageFailure(h: ReturnType<typeof harness>, body: unknown) {
  const response = await h.run(body);
  expect(response.status).toBe(503);
  const payload = await response.json();
  expect(Object.keys(payload)).toEqual(["error"]);
  expect(JSON.stringify(payload)).not.toMatch(/hidden-subject|private-query|987|hidden-task|protected-person/);
  assertNoSideEffects(h);
}

describe("automation current authority", () => {
  it.each(["oce-escalation-scanner", "oce-staffing-adequacy-computer", "risk-nightly-scorer"] as const)("rejects unauthenticated %s before database or provider access", async (surface) => {
    const h = harness(surface);
    expect((await h.run({}, false)).status).toBe(401);
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
    assertNoSideEffects(h);
  });
  it("blocks the authenticated legacy escalation scanner without querying recipients or sending messages", async () => {
    const h = harness("oce-escalation-scanner");
    const response = await h.run();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Escalation requires current recipient authority" });
    expect(h.from).not.toHaveBeenCalled();
    assertNoSideEffects(h);
  });
  it.each([{}, { notify: true }])("blocks risk notifications before queries for %j", async (body) => {
    const h = harness("risk-nightly-scorer");
    expect((await h.run(body)).status).toBe(409);
    expect(h.from).not.toHaveBeenCalled();
    assertNoSideEffects(h);
  });

  const unsafeTasks = [
    { id: "hidden-task", authority_class: "resident", subject_id: "protected-person" },
    { id: "hidden-task", authority_class: "unclassified", subject_id: null },
    { id: "hidden-task", completion_evidence_paths: ["protected-person/private.pdf"] },
    { id: "hidden-task", subject_id: null },
  ];
  it.each(unsafeTasks)("refuses staffing scoring when a scoped task is outside safe coverage: %j", async (unsafeTask) => {
    const h = harness("oce-staffing-adequacy-computer", { tables: { operation_task_instances: [task(), task(unsafeTask)] } });
    await assertCoverageFailure(h, { facility_id: SITE, date: DATE, shift: "day" });
  });
  it.each([
    ["oce-staffing-adequacy-computer", "stale-template-link"],
    ["oce-staffing-adequacy-computer", "moved-native-subject"],
    ["risk-nightly-scorer", "stale-template-link"],
    ["risk-nightly-scorer", "moved-native-subject"],
  ] as const)("%s cannot score a facility row excluded by the live %s projection", async (surface, reason) => {
    const excludedId = `hidden-task-${reason}`;
    const h = harness(surface, {
      tables: { operation_task_instances: [task(), task({ id: excludedId })] },
      automationExcludedIds: [excludedId],
    });
    await assertCoverageFailure(h, { organization_id: ORG, facility_id: SITE, date: DATE, shift: "day", notify: false });
    expect(h.from).toHaveBeenCalledWith("operation_automation_tasks");
    expect(h.from).toHaveBeenCalledWith("operation_task_instances");
  });
  it("refuses staffing scoring when query results truncate an otherwise classified population", async () => {
    const h = harness("oce-staffing-adequacy-computer", { tables: { operation_task_instances: [task(), task({ id: "second" })] }, truncateTasks: true });
    await assertCoverageFailure(h, { facility_id: SITE, date: DATE, shift: "day" });
  });
  it("does not turn a staffing query error into zero demand", async () => {
    const h = harness("oce-staffing-adequacy-computer", { failTable: "operation_task_instances" });
    await assertCoverageFailure(h, { facility_id: SITE, date: DATE, shift: "day" });
  });
  it("does not publish an incomplete later facility while retaining an earlier complete independent snapshot", async () => {
    const h = harness("oce-staffing-adequacy-computer", { tables: {
      facilities: [SITE, OTHER_SITE].map((id) => ({ id, organization_id: ORG, status: "active", name: "Site", timezone: "America/New_York" })),
      operation_task_instances: [task(), task({ id: "hidden-task", facility_id: OTHER_SITE, authority_class: "resident", subject_id: "protected-person" })],
    } });
    const response = await h.run({ date: DATE, shift: "day" });
    expect(response.status).toBe(503);
    expect(h.writes).toEqual([{ table: "staffing_adequacy_snapshots", action: "upsert", payload: expect.objectContaining({ facility_id: SITE, operation_authority_version: 1 }) }]);
    expect(JSON.stringify(await response.json())).not.toMatch(/hidden-task|protected-person/);
    expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(["oce-staffing-adequacy-computer", "risk-nightly-scorer"] as const)("does not disclose database detail when %s cannot load facilities", async (surface) => {
    const h = harness(surface, { failTable: "facilities" });
    const response = await h.run({ organization_id: ORG, notify: false });
    expect(JSON.stringify(await response.json())).not.toContain("hidden-subject-private-query-detail");
    assertNoSideEffects(h);
  });
  it("saves a version-1 staffing snapshot only for a completely covered selected facility", async () => {
    const h = harness("oce-staffing-adequacy-computer", { tables: { operation_task_instances: [task(), task({ facility_id: OTHER_SITE, authority_class: "resident", subject_id: "protected-person" })] } });
    const response = await h.run({ facility_id: SITE, date: DATE, shift: "day" });
    expect(response.status).toBe(200);
    expect(h.writes).toEqual([{ table: "staffing_adequacy_snapshots", action: "upsert", payload: expect.objectContaining({ facility_id: SITE, operation_authority_version: 1, pending_task_count: 1 }) }]);
    expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(unsafeTasks)("refuses risk scoring when scoped tasks are outside safe coverage: %j", async (unsafeTask) => {
    const h = harness("risk-nightly-scorer", { tables: { operation_task_instances: [task(), task(unsafeTask)] } });
    await assertCoverageFailure(h, { organization_id: ORG, facility_id: SITE, notify: false });
  });
  it("refuses risk scoring when staffing history includes a legacy unclassified aggregate", async () => {
    const h = harness("risk-nightly-scorer", { tables: { staffing_adequacy_snapshots: [{ id: "hidden-task", organization_id: ORG, facility_id: SITE, operation_authority_version: 0, created_at: new Date().toISOString(), cannot_cover_count: 987 }] } });
    await assertCoverageFailure(h, { organization_id: ORG, notify: false });
  });
  it("does not score when the current staffing population query fails", async () => {
    const h = harness("risk-nightly-scorer", { failTable: "staffing_adequacy_snapshots" });
    await assertCoverageFailure(h, { organization_id: ORG, notify: false });
  });
  it("computes with notify:false, excludes legacy previous snapshots, and saves the authority version", async () => {
    const h = harness("risk-nightly-scorer", { tables: { risk_score_snapshots: [{ id: "legacy", organization_id: ORG, facility_id: SITE, operation_authority_version: 0, risk_score: 10, risk_level: "critical", snapshot_date: DATE }] } });
    const response = await h.run({ organization_id: ORG, facility_id: SITE, notify: false });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.results[0].score_delta).toBeNull();
    expect(payload.sms_sent).toBe(0);
    expect(payload.results[0].notify_owners).toBe(false);
    expect(h.writes).toEqual([{ table: "risk_score_snapshots", action: "upsert", payload: expect.objectContaining({ operation_authority_version: 1, score_delta: null, owner_alert_triggered_at: null }) }]);
    expect(h.provider).not.toHaveBeenCalled();
  });
});
