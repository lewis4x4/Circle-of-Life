import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";
import { addFacilityCalendarDays, facilityDatetimeLocalToUtcIso } from "@/lib/facility-wall-clock";
import { fetchExecutiveStandupLive, standupCalendarWindow } from "./standup";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | null>;
const organizationId = "00000000-0000-4000-8000-000000000099";
const facilityId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

// Model the loader's read-only query contract without requiring hosted data.
function client(tables: Tables, failedTable?: string, options: { serverCap?: number; failOffset?: number } = {}) {
  const queries: Array<{ table: string; operations: unknown[][] }> = [];
  return {
    queries,
    supabase: {
      from(table: string) {
        const operations: unknown[][] = [];
        queries.push({ table, operations });
        const sourceRows: Row[] | undefined = tables[table]?.map((row, index) => ({ id: `${table}-${String(index).padStart(8, "0")}`, ...row }));
        let offset = 0;
        let rangeEnd = Infinity;
        let requestedLimit = Infinity;
        const query = {
          select(columns: string) { operations.push(["select", columns]); return query; },
          eq(column: string, value: unknown) { operations.push(["eq", column, value]); return query; },
          is(column: string, value: unknown) { operations.push(["is", column, value]); return query; },
          in(column: string, values: unknown[]) { operations.push(["in", column, values]); return query; },
          order(column: string) { operations.push(["order", column]); return query; },
          range(from: number, to: number) { operations.push(["range", from, to]); offset = from; rangeEnd = to; return query; },
          limit(count: number) { operations.push(["limit", count]); requestedLimit = count; return query; },
          then(resolve: (value: unknown) => unknown) {
            // PostgREST applies predicates before ORDER/LIMIT regardless of builder call order.
            let rows = sourceRows?.filter((row) => operations.every(([op, column, value]) => {
              if (op === "eq" || op === "is") return row[column as string] === value;
              if (op === "in") return (value as unknown[]).includes(row[column as string]);
              return true;
            }));
            const ordering = operations.find(([op]) => op === "order")?.[1] as string | undefined;
            if (ordering) rows = rows?.slice().sort((a, b) => String(a[ordering]).localeCompare(String(b[ordering])));
            rows = rows?.slice(offset, rangeEnd + 1).slice(0, requestedLimit);
            return Promise.resolve({ data: rows?.slice(0, options.serverCap ?? Infinity) ?? null, error: table === failedTable && (options.failOffset === undefined || offset >= options.failOffset) ? { message: `failed ${table}` } : null }).then(resolve);
          },
        };
        return query;
      },
    } as unknown as SupabaseClient<Database>,
  };
}

function fixture(now: Date, repeats = 1): Tables {
  const w = standupCalendarWindow(now);
  const midnight = (day: string) => facilityDatetimeLocalToUtcIso(`${day}T00:00`);
  const prevStart = midnight(w.completedLastWeekStart);
  const prevEnd = midnight(w.weekOf);
  const nextWeek = midnight(addFacilityCalendarDays(w.thisWeekEnd, 1));
  const timestamps = [new Date(Date.parse(prevStart) - 1).toISOString(), prevStart,
    new Date(Date.parse(prevEnd) - 1).toISOString(), prevEnd,
    new Date(Date.parse(nextWeek) - 1).toISOString(), nextWeek];
  const tables: Tables = { facilities: [] };
  for (let f = 1; f <= 5; f++) {
    tables.facilities!.push({ id: facilityId(f), name: `Facility ${f}`, total_licensed_beds: f * 10, organization_id: organizationId, deleted_at: null });
    const add = (table: string, row: Row) => {
      (tables[table] ??= []).push({ facility_id: facilityId(f), organization_id: organizationId, deleted_at: null, ...row });
    };
    for (let repeat = 0; repeat < repeats; repeat++) {
      timestamps.forEach((stamp, i) => {
        add("invoices", { balance_due: [100, -20, null, 300, 0, 51][i], due_date: i % 2 ? w.todayIso : w.completedLastWeekStart, total: 1000 + i, period_start: i % 2 ? `${w.monthYm}-01` : null, status: i === 5 ? "paid" : "sent" });
        add("residents", { status: ["active", "hospital_hold", "loa", "discharged", null, "active"][i], monthly_total_rate: [1000, null, 2000, 0, -1, 4000][i], discharge_target_date: i % 2 ? w.weekOf : null });
        add("staff", { termination_date: i % 2 ? w.completedLastWeekStart : null });
        add("time_records", { clock_in: stamp, overtime_hours: i + 0.125 });
        add("staff_attendance_events", { occurred_at: stamp, event_type: i === 2 ? "late_callout" : "callout" });
        add("staff_requisitions", { status: ["draft", "open", "interviewing", "offered", "filled", "cancelled"][i] });
        add("admission_cases", { status: i === 1 ? "cancelled" : "pending", target_move_in_date: i % 2 ? w.weekOf : null });
        add("referral_leads", { status: i === 3 ? "lost" : "new", tour_scheduled_for: stamp });
        add("referral_outreach_activities", { status: i === 5 ? "cancelled" : "planned", activity_type: i % 2 ? "home_health_provider" : "community_event", scheduled_for: stamp, performed_for_week: i === 0 ? w.weekOf : null });
        if (f !== 5) add("beds", { status: i === 5 ? "occupied" : null, current_resident_id: i === 4 ? "resident" : null, is_temporarily_blocked: i === 3, standup_availability_class: ["private", "sp_female", "sp_male", "sp_flexible", null, "private"][i] });
      });
    }
  }
  return tables;
}

function summary(result: Awaited<ReturnType<typeof fetchExecutiveStandupLive>>) {
  return result.facilities.map((f) => ({ name: f.facilityName, score: f.pressureScore, concern: f.topConcern,
    metrics: Object.fromEntries(Object.entries(f.metrics).map(([key, metric]) => [key, `${metric.valueNumeric} (${metric.confidenceBand})`])),
  }));
}

afterEach(() => vi.useRealTimers());

describe("live standup behavior", () => {
  it.each(["2026-09-05T16:00:00Z", "2026-03-09T16:00:00Z", "2026-11-02T17:00:00Z"])("preserves metrics and inclusive/exclusive week boundaries at %s", async (iso) => {
    const now = new Date(iso);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const mock = client(fixture(now));
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, null);
    expect(summary(result)).toMatchSnapshot();
    for (const facility of result.facilities.filter((f) => f.facilityId)) {
      expect(facility.metrics.callouts_last_week.valueNumeric).toBe(2);
      expect(facility.metrics.overtime_hours.valueNumeric).toBe(3.25);
      expect(facility.metrics.tours_expected.valueNumeric).toBe(1);
    }
    expect([...new Set(mock.queries.map((query) => query.table))].sort()).toEqual(Object.keys(fixture(now)).sort());
    for (const query of mock.queries) {
      expect(query.operations).toContainEqual(["eq", "organization_id", organizationId]);
      expect(query.operations).toContainEqual(["is", "deleted_at", null]);
      if (query.table !== "facilities") expect(query.operations).toContainEqual(["in", "facility_id", [1, 2, 3, 4, 5].map(facilityId)]);
    }
  });

  it("preserves single-facility scope, totals, and missing-bed capacity fallback", async () => {
    const now = new Date("2026-09-05T16:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const mock = client(fixture(now));
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, facilityId(5));
    expect(summary(result)).toMatchSnapshot();
    expect(result.facilities.map((f) => f.facilityId)).toEqual([facilityId(5), null]);
    expect(result.facilities[0].metrics.total_beds_open.valueNumeric).toBe(46);
    for (const query of mock.queries) expect(query.operations).toContainEqual(["eq", query.table === "facilities" ? "id" : "facility_id", facilityId(5)]);
  });

  it("preserves null datasets and the no-facilities placeholder", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T16:00:00Z"));
    expect(summary(await fetchExecutiveStandupLive(client({}).supabase, organizationId, null))).toMatchSnapshot();
    const result = await fetchExecutiveStandupLive(client({ facilities: [{ id: facilityId(1), name: "Empty facility", total_licensed_beds: 10, organization_id: organizationId, deleted_at: null }] }).supabase, organizationId, null);
    expect(result.facilities[0].metrics.total_beds_open.valueNumeric).toBe(10);
    expect(result.facilities[0].metrics.average_rent_cents.valueNumeric).toBeNull();
  });

  it.each(["facilities", "invoices", "residents", "staff", "time_records", "beds", "staff_attendance_events", "staff_requisitions", "admission_cases", "referral_outreach_activities", "referral_leads"])("continues to reject %s query errors", async (table) => {
    await expect(fetchExecutiveStandupLive(client(fixture(new Date("2026-09-05T16:00:00Z")), table).supabase, organizationId, null)).rejects.toThrow(`failed ${table}`);
  });

  it.skipIf(!process.env.HAVEN_PERF_BENCH)("measures synthetic five-facility processing", async () => {
    const now = new Date("2026-09-05T16:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const tables = fixture(now, 100);
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      await fetchExecutiveStandupLive(client(tables).supabase, organizationId, null);
      if (i > 0) times.push(performance.now() - start);
    }
    writeFileSync(`${process.env.HAVEN_PERF_BENCH}/standup.json`, JSON.stringify({ benchmark: "standup-29400-rows", medianMs: times.sort((a, b) => a - b)[2] }));
  });
});


describe("complete scoped standup reads", () => {
  it("includes current activity after more than 5,000 historical records", async () => {
    const now = new Date("2026-09-08T16:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const tables = fixture(now);
    tables.staff_attendance_events = Array.from({ length: 5001 }, (_, index) => ({
      id: String(index).padStart(8, "0"), organization_id: organizationId, facility_id: facilityId(1), deleted_at: null,
      event_type: "callout", occurred_at: index === 5000 ? "2026-09-02T12:00:00Z" : "2000-01-01T12:00:00Z",
    }));
    const mock = client(tables);
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, facilityId(1));
    expect(result.facilities[0].metrics.callouts_last_week.valueNumeric).toBe(1);
    const pages = mock.queries.filter((query) => query.table === "staff_attendance_events");
    expect(pages.some((query) => query.operations.some((op) => op[0] === "range" && Number(op[1]) >= 5000))).toBe(true);
    for (const query of pages) {
      expect(query.operations).toContainEqual(["eq", "organization_id", organizationId]);
      expect(query.operations).toContainEqual(["eq", "facility_id", facilityId(1)]);
      expect(query.operations).toContainEqual(["is", "deleted_at", null]);
      expect(query.operations).toContainEqual(["order", "id"]);
    }
  });

  it("continues below the requested page size and preserves all scope predicates", async () => {
    const now = new Date("2026-09-05T16:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const expected = await fetchExecutiveStandupLive(client(fixture(now)).supabase, organizationId, null);
    const mock = client(fixture(now), undefined, { serverCap: 2 });
    const actual = await fetchExecutiveStandupLive(mock.supabase, organizationId, null);
    expect(summary(actual)).toEqual(summary(expected));
    expect(actual.facilities.filter((row) => row.facilityId)).toHaveLength(5);
    for (const query of mock.queries) {
      expect(query.operations).toContainEqual(["eq", "organization_id", organizationId]);
      expect(query.operations).toContainEqual(["is", "deleted_at", null]);
      if (query.table !== "facilities") expect(query.operations).toContainEqual(["in", "facility_id", [1,2,3,4,5].map(facilityId)]);
      if (query.table === "invoices") expect(query.operations).toContainEqual(["in", "status", ["draft", "sent", "partial", "overdue"]]);
    }
  });

  it("rejects a later-page error rather than returning partial totals", async () => {
    const mock = client(fixture(new Date("2026-09-05T16:00:00Z")), "time_records", { serverCap: 2, failOffset: 2 });
    await expect(fetchExecutiveStandupLive(mock.supabase, organizationId, null)).rejects.toThrow("failed time_records");
  });

  it("does not query operational data when the accessible facility set is empty", async () => {
    const mock = client({ facilities: [], residents: [{ organization_id: organizationId, facility_id: facilityId(1), deleted_at: null, status: "active" }] });
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, null);
    expect(result.facilities[0].facilityName).toBe("No facilities in scope");
    expect(mock.queries.every((query) => query.table === "facilities")).toBe(true);
  });
});
