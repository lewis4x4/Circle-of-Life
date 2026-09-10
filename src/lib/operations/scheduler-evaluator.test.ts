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

function harness(tables: Record<string, Row[]>) {
  let handler: (request: Request) => Response | Promise<Response>;
  const writes: Array<{ table: string; payload: unknown }> = [];
  const from = vi.fn((table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    const result = async () => ({ data: (tables[table] ?? []).filter((row) => predicates.every((test) => test(row))), error: null });
    const chain = {
      select() { return chain; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return chain; },
      is(key: string, value: unknown) { predicates.push((row) => value === null ? row[key] == null : row[key] === value); return chain; },
      in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return chain; },
      gte(key: string, value: string) { predicates.push((row) => String(row[key]) >= value); return chain; },
      lte(key: string, value: string) { predicates.push((row) => String(row[key]) <= value); return chain; },
      async insert(payload: unknown) { writes.push({ table, payload }); return { error: null }; },
      then(resolve: (value: unknown) => unknown) { return result().then(resolve); },
    };
    return chain;
  });
  const source = readFileSync(`${process.cwd()}/supabase/functions/oce-task-scheduler/index.ts`, "utf8");
  const compiled = ts.transpileModule(source.replace(/^import .*;\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(compiled, {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => key === "OCE_TASK_SCHEDULER_SECRET" ? "secret" : key } },
    createClient: () => ({ from }), getCorsHeaders: () => ({}), jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    withTiming: () => ({ log: vi.fn() }), Response, Intl, Date, ...evaluator,
  });
  return {
    from, writes,
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
