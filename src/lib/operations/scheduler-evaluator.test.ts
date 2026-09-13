import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import * as evaluator from "./schedule-evaluator";

/**
 * The scheduler Edge function through a minimal sandbox: the shared evaluator
 * is injected as the real module, the Supabase client is a table stub. Proves
 * the scheduler dates work only through the evaluator, reports unknown
 * schedules instead of inventing dates, and refuses an unschedulable range
 * before touching the database.
 */
const ts = createRequire(`${process.cwd()}/package.json`)("typescript") as typeof import("typescript");
type Row = Record<string, unknown>;
const ORG = "00000000-0000-0000-0000-000000000001";
const SITE = "22222222-2222-4222-8222-222222222222";

type HarnessOptions = {
  /** Per-call RPC outcomes keyed by function name; a function without an entry returns an empty success. */
  rpc?: Record<string, (args: Row) => { data: unknown; error: { code?: string; message: string } | null }>;
  /** Insert outcomes in call order; a missing entry succeeds. */
  inserts?: Array<{ code?: string; message: string } | null>;
};

function harness(tables: Record<string, Row[]>, options: HarnessOptions = {}) {
  let handler: (request: Request) => Response | Promise<Response>;
  const writes: Array<{ table: string; payload: unknown }> = [];
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const rangeCalls: Array<{ table: string; from: number; to: number }> = [];
  const insertOutcomes = [...(options.inserts ?? [])];
  const from = vi.fn((table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let slice: [number, number] | null = null;
    const result = async () => {
      const rows = (tables[table] ?? []).filter((row) => predicates.every((test) => test(row)));
      return { data: slice ? rows.slice(slice[0], slice[1] + 1) : rows, error: null };
    };
    const chain = {
      select() { return chain; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return chain; },
      is(key: string, value: unknown) { predicates.push((row) => value === null ? row[key] == null : row[key] === value); return chain; },
      in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return chain; },
      gte(key: string, value: string) { predicates.push((row) => String(row[key]) >= value); return chain; },
      lte(key: string, value: string) { predicates.push((row) => String(row[key]) <= value); return chain; },
      not(key: string, operator: string, value: unknown) { predicates.push((row) => operator === "is" && value === null ? row[key] != null : row[key] !== value); return chain; },
      order() { return chain; },
      range(start: number, end: number) { slice = [start, end]; rangeCalls.push({ table, from: start, to: end }); return chain; },
      async insert(payload: unknown) {
        writes.push({ table, payload });
        const outcome = insertOutcomes.shift();
        return { error: outcome ?? null };
      },
      then(resolve: (value: unknown) => unknown) { return result().then(resolve); },
    };
    return chain;
  });
  const rpc = vi.fn(async (fn: string, args: Row) => {
    rpcCalls.push({ fn, args });
    const outcome = options.rpc?.[fn];
    return outcome ? outcome(args) : { data: {}, error: null };
  });
  const source = readFileSync(`${process.cwd()}/supabase/functions/oce-task-scheduler/index.ts`, "utf8");
  const compiled = ts.transpileModule(source.replace(/^import .*;\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(compiled, {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => key === "OCE_TASK_SCHEDULER_SECRET" ? "secret" : key } },
    createClient: () => ({ from, rpc }), getCorsHeaders: () => ({}), jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    withTiming: () => ({ log: vi.fn() }), Response, Intl, Date, Number, Set, Map, Array, crypto, ...evaluator,
  });
  return {
    from, rpc, writes, rpcCalls, rangeCalls,
    run: (body: unknown) => Promise.resolve(handler!(new Request("https://haven.test/scheduler", { method: "POST", headers: { "x-cron-secret": "secret" }, body: JSON.stringify(body) }))),
  };
}

const template = (overrides: Row): Row => ({
  id: "daily", organization_id: ORG, facility_id: null, name: "Round", category: "daily_rounds", cadence_type: "daily", shift_scope: "day",
  day_of_week: null, day_of_month: null, month_of_year: null, assignee_role: "cna", required_role_fallback: null,
  escalation_ladder: [{ role: "lpn_supervisor", sla_minutes: 15, enabled: true }], priority: "normal", license_threatening: false,
  estimated_minutes: 10, requires_dual_sign: false, is_active: true, deleted_at: null, ...overrides,
});

describe("scheduler on the shared evaluator", () => {
  const tables = {
    facilities: [{ id: SITE, organization_id: ORG, status: "active", deleted_at: null, timezone: "America/New_York" }],
    operation_task_templates: [
      template({ id: "daily" }),
      template({ id: "weekly", name: "Weekly check", cadence_type: "weekly", shift_scope: null, day_of_week: 4 }),
      template({ id: "on-demand", name: "As needed", cadence_type: "on_demand", shift_scope: null }),
    ],
    operation_task_instances: [],
  };

  it("dates generated work through the evaluator and reports unknown schedules instead of inventing dates", async () => {
    const h = harness(tables);
    const response = await h.run({ date_from: "2026-09-10", date_to: "2026-09-10", dry_run: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, dry_run: true, generated: 2, unknown_schedules: 1, evaluator_version: evaluator.SCHEDULE_EVALUATOR_VERSION });
    const byTemplate = new Map(body.preview.map((candidate: Row) => [candidate.template_id, candidate]));
    expect(byTemplate.get("daily")).toMatchObject({ assigned_shift_date: "2026-09-10", assigned_shift: "day", due_at: "2026-09-10T11:15:00.000Z" });
    expect(byTemplate.get("weekly")).toMatchObject({ assigned_shift_date: "2026-09-10", assigned_shift: null, due_at: "2026-09-10T13:15:00.000Z" });
    expect(body.unknown_schedule_preview).toEqual([{ template_id: "on-demand", facility_id: SITE, shift: null, reason: "on_demand templates have no recurrence" }]);
    expect(h.writes).toEqual([]);
  });

  it("skips existing occurrences and inserts the rest with evaluator due instants", async () => {
    const h = harness({ ...tables, operation_task_instances: [{ organization_id: ORG, facility_id: SITE, template_id: "daily", assigned_shift_date: "2026-09-10", assigned_shift: "day", deleted_at: null }] });
    const response = await h.run({ date_from: "2026-09-10", date_to: "2026-09-10" });
    expect(await response.json()).toMatchObject({ inserted: 1, skipped_existing: 1, unknown_schedules: 1 });
    expect(h.writes).toHaveLength(1);
    expect((h.writes[0].payload as Row[]).map((row) => row.template_id)).toEqual(["weekly"]);
  });

  it("refuses an unschedulable range before any query", async () => {
    const h = harness(tables);
    const response = await h.run({ date_from: "2026-01-01", date_to: "2029-01-01", dry_run: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("range exceeds 800 days");
    expect(h.from).not.toHaveBeenCalled();
  });
});

const ACTIVITY = "11111111-1111-4111-8111-111111111111";
// Stored exactly as a draft command may save it: an explicit null calendar key
// that the evaluator's normalised copy drops. The scheduler must send the
// stored column back, not the normalised copy, or the database's jsonb
// equality check refuses every run.
const weeklyRule = { rule_version: 1, timezone: "America/New_York", recurrence: { kind: "weekly", weekday: "thursday" }, deadline: { time: "10:00", grace_minutes: 60 }, reminder: { lead_minutes: 120 }, calendar: null };
const configuration = (overrides: Row): Row => ({
  id: "config-1", organization_id: ORG, facility_id: SITE, activity_id: ACTIVITY, requirement_version_id: "version-1", status: "published",
  applicability: "applicable", schedule_status: "confirmed", effective_from: "2026-01-01T05:00:00.000Z", effective_to: null, schedule_rule: weeklyRule, ...overrides,
});

describe("scheduler managed occurrences (COL-139)", () => {
  const managedTables = {
    facilities: [{ id: SITE, organization_id: ORG, status: "active", deleted_at: null, timezone: "America/New_York" }],
    operation_task_templates: [] as Row[],
    operation_task_instances: [] as Row[],
    operation_facility_requirements: [configuration({})],
  };

  it("generates only through the evaluator and the database command, pinning the rule it evaluated", async () => {
    const generate = vi.fn(() => ({ data: { counts: { created: 2, existing: 1, conflict: 0, no_binding: 1, binding_not_current: 0, configuration_not_in_force: 0, invalid: 0 } }, error: null }));
    // The database returns the closed/cancelled ids as arrays and the numbers under counts.
    const reconcile = vi.fn(() => ({ data: { bindings_closed: ["binding-1"], occurrences_cancelled: ["task-1", "task-2"], counts: { bindings_closed: 1, occurrences_cancelled: 2 } }, error: null }));
    const h = harness(managedTables, { rpc: { generate_operation_occurrences_service: generate, reconcile_operation_occurrences_service: reconcile } });
    const response = await h.run({ date_from: "2026-09-07", date_to: "2026-09-20" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.managed).toMatchObject({
      configurations: 1, occurrences_evaluated: 2, created: 2, existing: 1, conflict: 0, no_binding: 1, rpc_failed: 0, event_rules_awaiting_source: 0, superseded_templates: 0,
      reconciled: { facilities: 1, bindings_closed: 1, occurrences_cancelled: 2, failed: 0 },
    });
    expect(h.rpcCalls.map((call) => call.fn)).toEqual(["generate_operation_occurrences_service", "reconcile_operation_occurrences_service"]);
    const args = h.rpcCalls[0].args as { p_facility: string; p_configuration: string; p_occurrences: Row[]; p_run: Row };
    expect(args.p_facility).toBe(SITE);
    expect(args.p_configuration).toBe("config-1");
    expect(args.p_run).toEqual({ run_id: body.run_id, evaluator_version: evaluator.SCHEDULE_EVALUATOR_VERSION, rule: weeklyRule, date_from: "2026-09-07", date_to: "2026-09-20" });
    expect(args.p_run.rule).toHaveProperty("calendar", null);
    expect(args.p_occurrences).toEqual([
      { occurrence_date: "2026-09-10", period: { start_date: "2026-09-07", end_date: "2026-09-13" }, due_at: "2026-09-10T14:00:00.000Z", grace_ends_at: "2026-09-10T15:00:00.000Z", remind_at: "2026-09-10T12:00:00.000Z", timezone: "America/New_York", adjustments: [] },
      { occurrence_date: "2026-09-17", period: { start_date: "2026-09-14", end_date: "2026-09-20" }, due_at: "2026-09-17T14:00:00.000Z", grace_ends_at: "2026-09-17T15:00:00.000Z", remind_at: "2026-09-17T12:00:00.000Z", timezone: "America/New_York", adjustments: [] },
    ]);
    expect(h.writes).toEqual([]);
  });

  it("clips enumeration to the configuration window in the rule timezone", async () => {
    const h = harness({ ...managedTables, operation_facility_requirements: [configuration({ effective_from: "2026-09-11T04:00:00.000Z", effective_to: "2026-09-18T03:59:00.000Z" })] });
    const body = await (await h.run({ date_from: "2026-09-01", date_to: "2026-09-30" })).json();
    const args = h.rpcCalls[0].args as { p_occurrences: Row[] };
    expect(args.p_occurrences.map((occurrence) => occurrence.occurrence_date)).toEqual(["2026-09-17"]);
    expect(body.managed.occurrences_evaluated).toBe(1);
  });

  it("skips a configuration whose window does not touch the range without calling the database", async () => {
    const h = harness({ ...managedTables, operation_facility_requirements: [configuration({ effective_from: "2026-12-01T05:00:00.000Z" })] });
    const body = await (await h.run({ date_from: "2026-09-01", date_to: "2026-09-30" })).json();
    expect(body.managed.configurations).toBe(0);
    expect(h.rpcCalls.map((call) => call.fn)).toEqual(["reconcile_operation_occurrences_service"]);
  });

  it("reports an event rule as awaiting its source and an invalid stored rule as unknown, never generating either", async () => {
    const h = harness({
      ...managedTables,
      operation_facility_requirements: [
        configuration({ id: "event", schedule_rule: { ...weeklyRule, recurrence: { kind: "event", event_key: "admission" } } }),
        configuration({ id: "broken", schedule_rule: { kind: "weekly" } }),
      ],
    });
    const body = await (await h.run({ date_from: "2026-09-07", date_to: "2026-09-20", dry_run: true })).json();
    expect(body.managed).toMatchObject({ configurations: 0, event_rules_awaiting_source: 1, occurrences_evaluated: 0 });
    expect(body.unknown_schedules).toBe(1);
    expect(body.unknown_schedule_preview).toEqual([{ configuration_id: "broken", facility_id: SITE, shift: null, reason: "schedule rule has an unknown field: kind" }]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("supersedes a legacy template whose activity has a confirmed configuration in force at the site", async () => {
    const h = harness({
      ...managedTables,
      operation_task_templates: [template({ id: "legacy-weekly", activity_id: ACTIVITY, cadence_type: "weekly", shift_scope: null, day_of_week: 4 }), template({ id: "other", activity_id: "other-activity" })],
    });
    const body = await (await h.run({ date_from: "2026-09-10", date_to: "2026-09-10", dry_run: true })).json();
    expect(body.managed.superseded_templates).toBe(1);
    expect(body.generated).toBe(1);
    expect(body.preview.map((candidate: Row) => candidate.template_id)).toEqual(["other"]);
  });

  it("supersedes a legacy template only on dates the configuration is in force, so catch-up before it still generates", async () => {
    const h = harness({
      ...managedTables,
      operation_facility_requirements: [configuration({ effective_from: "2026-09-15T04:00:00.000Z" })],
      operation_task_templates: [template({ id: "legacy-weekly", activity_id: ACTIVITY, cadence_type: "weekly", shift_scope: null, day_of_week: 4 })],
    });
    const body = await (await h.run({ date_from: "2026-09-10", date_to: "2026-09-17", dry_run: true })).json();
    expect(body.preview.map((candidate: Row) => [candidate.template_id, candidate.assigned_shift_date])).toEqual([["legacy-weekly", "2026-09-10"]]);
    expect(body.managed.superseded_templates).toBe(1);
    expect(body.managed_preview.map((candidate: Row) => candidate.occurrence_date)).toEqual(["2026-09-17"]);
  });

  it("does not let an event rule or an invalid stored rule supersede a legacy template", async () => {
    const h = harness({
      ...managedTables,
      operation_facility_requirements: [configuration({ id: "event", schedule_rule: { ...weeklyRule, recurrence: { kind: "event", event_key: "admission" } } }), configuration({ id: "broken", schedule_rule: { kind: "weekly" } })],
      operation_task_templates: [template({ id: "legacy-weekly", activity_id: ACTIVITY, cadence_type: "weekly", shift_scope: null, day_of_week: 4 })],
    });
    const body = await (await h.run({ date_from: "2026-09-10", date_to: "2026-09-10", dry_run: true })).json();
    expect(body.managed.superseded_templates).toBe(0);
    expect(body.preview.map((candidate: Row) => candidate.template_id)).toEqual(["legacy-weekly"]);
  });

  it("reads configuration pages to the last short page", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => configuration({ id: `config-${index}` }));
    const h = harness({ ...managedTables, operation_facility_requirements: rows });
    const body = await (await h.run({ date_from: "2026-09-10", date_to: "2026-09-10", dry_run: true })).json();
    expect(h.rangeCalls.filter((call) => call.table === "operation_facility_requirements")).toEqual([{ table: "operation_facility_requirements", from: 0, to: 199 }, { table: "operation_facility_requirements", from: 200, to: 399 }]);
    expect(body.managed.configurations).toBe(201);
  });

  it("reads existing legacy rows page by page so a long range never loses the activity-keyed skip", async () => {
    // 500 rows of other activities fill the first page; the 501st, on the second
    // page, is the earlier template revision's row for the requested day.
    const existing = Array.from({ length: 501 }, (_, index) => ({
      id: `row-${String(index).padStart(3, "0")}`, organization_id: ORG, facility_id: SITE, template_id: index === 500 ? "old-revision" : `other-${index}`,
      activity_id: "daily-activity", assigned_shift_date: "2026-09-29", assigned_shift: index === 500 ? "day" : "night", deleted_at: null,
    }));
    const h = harness({
      ...managedTables,
      operation_task_templates: [template({ id: "daily", activity_id: "daily-activity" })],
      operation_task_instances: existing,
      operation_facility_requirements: [],
    });
    const body = await (await h.run({ date_from: "2026-09-29", date_to: "2026-09-29", dry_run: true })).json();
    expect(h.rangeCalls.filter((call) => call.table === "operation_task_instances")).toEqual([{ table: "operation_task_instances", from: 0, to: 499 }, { table: "operation_task_instances", from: 500, to: 999 }]);
    // The 501st row (only reachable on the second page) is the one for the requested day.
    expect(body).toMatchObject({ generated: 0, skipped_existing: 1 });
  });

  it("counts a failing command for one configuration and keeps going", async () => {
    const generate = vi.fn((args: Row) => (args.p_configuration === "config-1" ? { data: null, error: { message: "rule mismatch" } } : { data: { counts: { created: 1 } }, error: null }));
    const h = harness({ ...managedTables, operation_facility_requirements: [configuration({}), configuration({ id: "config-2" })] }, { rpc: { generate_operation_occurrences_service: generate } });
    const response = await h.run({ date_from: "2026-09-10", date_to: "2026-09-10" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.managed).toMatchObject({ rpc_failed: 1, created: 1, rpc_failures: [{ configuration_id: "config-1", facility_id: SITE, reason: "rule mismatch" }] });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("previews managed candidates in a dry run without any command", async () => {
    const h = harness(managedTables);
    const body = await (await h.run({ date_from: "2026-09-07", date_to: "2026-09-20", dry_run: true })).json();
    expect(h.rpcCalls).toEqual([]);
    expect(body.managed_preview).toEqual([
      { configuration_id: "config-1", facility_id: SITE, activity_id: ACTIVITY, occurrence_date: "2026-09-10", period: { start_date: "2026-09-07", end_date: "2026-09-13" }, due_at: "2026-09-10T14:00:00.000Z" },
      { configuration_id: "config-1", facility_id: SITE, activity_id: ACTIVITY, occurrence_date: "2026-09-17", period: { start_date: "2026-09-14", end_date: "2026-09-20" }, due_at: "2026-09-17T14:00:00.000Z" },
    ]);
  });

  it("keys legacy existence on the stable activity so a revised template does not duplicate a period", async () => {
    const h = harness({
      ...managedTables,
      operation_task_templates: [template({ id: "daily-v2", activity_id: "activity-daily" })],
      operation_task_instances: [{ organization_id: ORG, facility_id: SITE, template_id: "daily-v1", activity_id: "activity-daily", assigned_shift_date: "2026-09-10", assigned_shift: "day", deleted_at: null }],
    });
    const body = await (await h.run({ date_from: "2026-09-10", date_to: "2026-09-10" })).json();
    expect(body).toMatchObject({ inserted: 0, generated: 0, skipped_existing: 1 });
    expect(h.writes).toEqual([]);
  });

  it("converges a concurrent legacy duplicate row by row instead of failing the run", async () => {
    const h = harness(
      { ...managedTables, operation_task_templates: [template({ id: "a", activity_id: "act-a" }), template({ id: "b", activity_id: "act-b", name: "Other" })] },
      { inserts: [{ code: "23505", message: "duplicate key" }, null, { code: "23505", message: "duplicate key" }] },
    );
    const response = await h.run({ date_from: "2026-09-10", date_to: "2026-09-10" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ inserted: 1, generated: 2, skipped_existing: 1 });
    expect(h.writes).toHaveLength(3);
  });

  it("reports rows already inserted when the row-by-row convergence hits a different error", async () => {
    const h = harness(
      { ...managedTables, operation_task_templates: [template({ id: "a", activity_id: "act-a" }), template({ id: "b", activity_id: "act-b", name: "Other" })] },
      { inserts: [{ code: "23505", message: "duplicate key" }, null, { code: "42501", message: "Authenticated operation actor required" }] },
    );
    const response = await h.run({ date_from: "2026-09-10", date_to: "2026-09-10" });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "Failed to insert generated task instances", inserted: 1, skipped_existing: 0 });
    expect(body.managed).toBeDefined();
  });

  it("splits more than 400 evaluator periods into two generation commands", async () => {
    const dailyRule = { ...weeklyRule, recurrence: { kind: "weekday_set", weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] } };
    const generate = vi.fn(() => ({ data: { counts: { created: 1 } }, error: null }));
    const h = harness({ ...managedTables, operation_facility_requirements: [configuration({ schedule_rule: dailyRule })] }, { rpc: { generate_operation_occurrences_service: generate } });
    // 401 daily periods: one full batch of 400 and one of 1.
    const body = await (await h.run({ date_from: "2026-01-01", date_to: "2027-02-05" })).json();
    const calls = h.rpcCalls.filter((call) => call.fn === "generate_operation_occurrences_service");
    expect(calls.map((call) => (call.args as { p_occurrences: Row[] }).p_occurrences.length)).toEqual([400, 1]);
    expect(body.managed).toMatchObject({ occurrences_evaluated: 401, created: 2 });
  });
});
