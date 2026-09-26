import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";
import { STANDUP_MONDAY_NOT_SUBMITTED_NOTE, fetchExecutiveStandupLive } from "./standup";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | null>;
const organizationId = "00000000-0000-4000-8000-000000000099";
const facilityId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

// Model the loader's read-only query contract without requiring hosted data.
function client(tables: Tables, failedTable?: string, submitted: { data: unknown; error: { message: string; code?: string } | null } = { data: [], error: null }) {
  const queries: Array<{ table: string; operations: unknown[][] }> = [];
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  return {
    queries,
    rpcCalls,
    supabase: {
      rpc(name: string, args: Record<string, unknown>) { rpcCalls.push([name, args]); return Promise.resolve(submitted); },
      from(table: string) {
        const operations: unknown[][] = [];
        queries.push({ table, operations });
        let rows: Row[] | null | undefined = tables[table];
        const query = {
          select(columns: string) { operations.push(["select", columns]); return query; },
          eq(column: string, value: unknown) { operations.push(["eq", column, value]); rows = rows?.filter((r) => r[column] === value); return query; },
          is(column: string, value: unknown) { operations.push(["is", column, value]); rows = rows?.filter((r) => r[column] === value); return query; },
          in(column: string, values: unknown[]) { operations.push(["in", column, values]); rows = rows?.filter((r) => values.includes(r[column])); return query; },
          order(column: string) { operations.push(["order", column]); rows = rows?.slice().sort((a, b) => String(a[column]).localeCompare(String(b[column]))); return query; },
          limit(count: number) { operations.push(["limit", count]); rows = rows?.slice(0, count); return query; },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: rows ?? null, error: table === failedTable ? { message: `failed ${table}` } : null }).then(resolve);
          },
        };
        return query;
      },
    } as unknown as SupabaseClient<Database>,
  };
}

const facility = (i: number, name = `Facility ${i}`) => ({ id: facilityId(i), name, total_licensed_beds: 40, organization_id: organizationId, deleted_at: null });
const mondayValues = (patch: Record<string, number | null> = {}) => ({
  monthly_rent_roll_cents: 11_710_816, current_total_census: 34, hospital_and_rehab_total: 1,
  sp_female_beds_open: 1, sp_male_beds_open: 0, sp_flexible_beds_open: 2, private_beds_open: 3,
  admissions_expected: 2, expected_discharges: 0, callouts_last_week: 4, terminations_last_week: 1,
  current_open_positions: 3, overtime_reported: 17.15, tours_expected: 5, provider_activities_expected: 1, outreach_engagements: 2, ...patch,
});
const submission = (i: number, patch: Record<string, number | null> = {}) => ({
  facility_id: facilityId(i), week_start: "2026-09-21", revision_id: `rev-${i}`, submitted_at: "2026-09-21T12:40:00Z", values: mondayValues(patch),
});

afterEach(() => vi.useRealTimers());

describe("Executive Stand Up reads Monday's submitted figures (COL-753)", () => {
  it("takes every Monday figure from the latest submission, never from a second computation", async () => {
    // Live invoices, residents and beds can differ from the administrator's
    // verified Monday figures; COL-585 classification does not recompute this report.
    const tables: Tables = {
      facilities: [facility(1, "Homewood")],
      invoices: [{ facility_id: facilityId(1), organization_id: organizationId, deleted_at: null, status: "draft", balance_due: 999, due_date: "2026-05-15", total: 999, period_start: null }],
      residents: [{ facility_id: facilityId(1), organization_id: organizationId, deleted_at: null, status: "active", monthly_total_rate: 5000 }],
      rooms: [{ id: "private-room", facility_id: facilityId(1), organization_id: organizationId, deleted_at: null, room_type: "private" }],
      beds: [{ id: "open-bed", room_id: "private-room", facility_id: facilityId(1), organization_id: organizationId, deleted_at: null, status: "available", current_resident_id: null }],
    };
    const mock = client(tables, undefined, { data: [submission(1)], error: null });
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, null);
    const homewood = result.facilities.find((f) => f.facilityId === facilityId(1))!;
    expect(homewood.metrics.current_ar_cents.valueNumeric).toBe(11_710_816);
    expect(homewood.metrics.current_total_census.valueNumeric).toBe(34);
    expect(homewood.metrics.hospital_and_rehab_total.valueNumeric).toBe(1);
    expect(homewood.metrics.callouts_last_week.valueNumeric).toBe(4);
    expect(homewood.metrics.tours_expected.valueNumeric).toBe(5);
    // Overtime is stored as the legacy hours.minutes notation: 17 h 15 min.
    expect(homewood.metrics.overtime_hours.valueNumeric).toBe(17.25);
    expect(homewood.metrics.total_beds_open.valueNumeric).toBe(6);
    expect(homewood.metrics.sp_female_beds_open.valueNumeric).toBe(1);
    expect(homewood.metrics.sp_male_beds_open.valueNumeric).toBe(0);
    expect(homewood.metrics.sp_flexible_beds_open.valueNumeric).toBe(2);
    expect(homewood.metrics.private_beds_open.valueNumeric).toBe(3);
    expect(homewood.metrics.private_beds_open.sourceRefJson).toEqual([{ table: "stand_up_revisions", revision_id: "rev-1", week_start: "2026-09-21", field: "private_beds_open" }]);
    expect(homewood.metrics.current_ar_cents.sourceRefJson).toEqual([{ table: "stand_up_revisions", revision_id: "rev-1", week_start: "2026-09-21", field: "monthly_rent_roll_cents" }]);
    expect(homewood.metrics.current_ar_cents.overrideNote).toBe("As submitted for the Monday Stand Up of 2026-09-21.");
    expect(homewood.metrics.current_ar_cents.freshnessAt).toBe("2026-09-21T12:40:00Z");
    // Figures Monday does not report are still Haven's own.
    expect(homewood.metrics.average_rent_cents.valueNumeric).toBe(5000);
    expect(homewood.metrics.uncollected_ar_total_cents.valueNumeric).toBe(999);
    expect(mock.rpcCalls).toEqual([["stand_up_command", { p_action: "submitted_latest", p_payload: {} }]]);
    expect(mock.queries.map((query) => query.table)).toEqual(["facilities", "invoices", "residents"]);
  });

  it("shows a facility that has not submitted as blank with the reason, never 0, and marks totals partial (COL-649)", async () => {
    const mock = client({ facilities: [facility(1), facility(2)] }, undefined, { data: [submission(1)], error: null });
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, null);
    const missing = result.facilities.find((f) => f.facilityId === facilityId(2))!;
    expect(missing.metrics.current_total_census.valueNumeric).toBeNull();
    expect(missing.metrics.current_total_census.overrideNote).toBe(STANDUP_MONDAY_NOT_SUBMITTED_NOTE);
    expect(missing.metrics.total_beds_open.valueNumeric).toBeNull();
    expect(missing.topConcern).toBe("Not enough recorded to judge pressure");
    const totals = result.facilities.find((f) => f.facilityName === "Totals")!;
    expect(totals.metrics.current_total_census.valueNumeric).toBe(34);
    expect(totals.metrics.current_total_census.confidenceBand).toBe("low");
    expect(totals.metrics.current_total_census.overrideNote).toBe("1 of 2 facilities reporting.");
  });

  it("keeps a figure left blank on the submission blank", async () => {
    const mock = client({ facilities: [facility(1)] }, undefined, { data: [submission(1, { current_open_positions: null, private_beds_open: null })], error: null });
    const [row] = (await fetchExecutiveStandupLive(mock.supabase, organizationId, null)).facilities;
    expect(row.metrics.current_open_positions.valueNumeric).toBeNull();
    expect(row.metrics.current_open_positions.overrideNote).toBe("Not provided on the submitted Monday report.");
    expect(row.metrics.total_beds_open.valueNumeric).toBeNull();
  });

  it("says who may read Monday reports instead of showing zeros to a role that cannot", async () => {
    const mock = client({ facilities: [facility(1)] }, undefined, { data: null, error: { message: "Stand Up access denied", code: "42501" } });
    const [row] = (await fetchExecutiveStandupLive(mock.supabase, organizationId, null)).facilities;
    expect(row.metrics.current_ar_cents.valueNumeric).toBeNull();
    expect(row.metrics.current_ar_cents.overrideNote).toBe("Only owners, org admins and administrators can read submitted Monday Stand Up reports.");
  });

  it("scopes a single facility, including the submission read", async () => {
    const mock = client({ facilities: [facility(1), facility(5)] }, undefined, { data: [submission(5)], error: null });
    const result = await fetchExecutiveStandupLive(mock.supabase, organizationId, facilityId(5));
    expect(result.facilities.map((f) => f.facilityId)).toEqual([facilityId(5), null]);
    expect(mock.rpcCalls[0][1]).toEqual({ p_action: "submitted_latest", p_payload: { facility_id: facilityId(5) } });
    for (const query of mock.queries) expect(query.operations).toContainEqual(["eq", query.table === "facilities" ? "id" : "facility_id", facilityId(5)]);
  });

  it("preserves the no-facilities placeholder", async () => {
    const result = await fetchExecutiveStandupLive(client({}).supabase, organizationId, null);
    expect(result.facilities.map((f) => f.facilityName)).toEqual(["No facilities in scope", "Totals"]);
  });

  it.each(["facilities", "invoices", "residents"])("continues to reject %s query errors", async (table) => {
    await expect(fetchExecutiveStandupLive(client({}, table).supabase, organizationId, null)).rejects.toThrow(`failed ${table}`);
  });
});
