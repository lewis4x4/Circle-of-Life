import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import { effectivePunches } from "./compute";
import { loadStaffTimeclock, loadTimeclockPeriod } from "./load";

type Row = Record<string, unknown>;
const FACILITY = "facility-a";
const STAFF = "staff-a";
const period = { periodStart: new Date("2026-11-02T05:00:00Z"), periodEnd: new Date("2026-11-09T05:00:00Z") };
const person = (id = STAFF) => ({ id, first_name: "Test", last_name: "Staff", preferred_name: null, employment_status: "active", facility_id: FACILITY, deleted_at: null });
const punch = (id: string, punched_at = "2026-11-03T12:00:00Z") => ({ id, staff_id: STAFF, facility_id: FACILITY, punch_type: "in", punched_at, flags: [] });
const correction = (id: string, extra: Row = {}) => ({ id, staff_id: STAFF, facility_id: FACILITY, correction_type: "add_punch", target_punch_id: null, target_correction_id: null, punch_type: "out", corrected_punched_at: "2026-11-03T20:00:00Z", exception_key: null, reason: "missed_punch", note: null, corrected_by: "manager", corrected_at: "2026-11-10T12:00:00Z", ...extra });

/** Emulate the hosted 1,000-row cap, filters, ordering and inclusive ranges. */
function database(tables: Record<string, Row[]>, failOffset?: number) {
  const queries: { table: string; filters: string[]; order: string[]; offset: number }[] = [];
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      const query = { table, filters: [] as string[], order: [] as string[], offset: 0 };
      let size = 1000;
      const filter = (name: string, predicate: (row: Row) => boolean) => { query.filters.push(name); filters.push(predicate); return builder; };
      const result = () => {
        queries.push(query);
        if (query.offset === failOffset) return { data: null, count: null, error: { message: "later page unavailable" } };
        const rows = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row))).sort((a, b) => {
          for (const column of query.order) {
            const comparison = String(a[column]).localeCompare(String(b[column]));
            if (comparison) return comparison;
          }
          return 0;
        });
        return { data: rows.slice(query.offset, query.offset + Math.min(size, 1000)), count: rows.length, error: null };
      };
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => filter(key, (row) => row[key] === value),
        is: (key: string, value: unknown) => filter(key, (row) => row[key] === value),
        in: (key: string, values: unknown[]) => filter(key, (row) => values.includes(row[key])),
        gte: (key: string, value: string) => filter(key, (row) => typeof row[key] === "string" && row[key] >= value),
        lt: (key: string, value: string) => filter(key, (row) => typeof row[key] === "string" && row[key] < value),
        order: (key: string) => { query.order.push(key); return builder; },
        limit: (value: number) => { size = value; return builder; },
        range: (start: number, end: number) => { query.offset = start; size = end - start + 1; return builder; },
        maybeSingle: async () => { const response = result(); return { ...response, data: response.data?.[0] ?? null }; },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, queries };
}

describe("timeclock period loading", () => {
  it("loads every page of punches, home staff, corrections and rejections with stable ID ordering", async () => {
    const many = (make: (id: string) => Row) => Array.from({ length: 1005 }, (_, index) => make(String(index).padStart(5, "0")));
    const { client, queries } = database({
      staff: [person(), ...many(person)],
      time_punches: many(punch),
      time_punch_corrections: many(correction),
      timeclock_sync_rejections: many((id) => ({ id, staff_id: STAFF, facility_id: FACILITY, created_at: "2026-11-03T12:00:00Z" })),
    });
    const loaded = await loadTimeclockPeriod(client, { facilityId: FACILITY, ...period });
    expect(loaded.punches).toHaveLength(1005);
    expect(loaded.staff).toHaveLength(1006);
    expect(loaded.corrections).toHaveLength(1005);
    expect(loaded.rejections).toHaveLength(1005);
    expect(queries.filter((query) => query.offset > 0).every((query) => query.order.at(-1) === "id")).toBe(true);
  });

  it("bounds correction seeds by punch date while preserving late voids and acknowledgements", async () => {
    const { client, queries } = database({
      staff: [person()],
      time_punches: [punch("p1")],
      time_punch_corrections: [
        correction("old", { corrected_punched_at: "2025-01-01T20:00:00Z" }),
        correction("added"),
        correction("void", { correction_type: "void_punch", target_punch_id: "p1", corrected_punched_at: null }),
        correction("void-added", { correction_type: "void_punch", target_correction_id: "added", corrected_punched_at: null }),
        correction("ack", { correction_type: "acknowledge", exception_key: "clock_skew:p1", corrected_punched_at: null }),
        correction("rejection-ack", { correction_type: "acknowledge", exception_key: "rejected_offline_sync:r1", corrected_punched_at: null }),
      ],
      timeclock_sync_rejections: [{ id: "r1", staff_id: STAFF, facility_id: FACILITY, created_at: "2026-11-03T12:00:00Z" }],
    });
    const loaded = await loadTimeclockPeriod(client, { facilityId: FACILITY, ...period });
    expect(loaded.corrections.map((row) => row.id).sort()).toEqual(["ack", "added", "rejection-ack", "void", "void-added"]);
    expect(effectivePunches(loaded.punches, loaded.corrections)).toEqual([]);
    expect(queries.filter((query) => query.table === "time_punch_corrections").every((query) => query.filters.some((key) => ["corrected_punched_at", "target_punch_id", "target_correction_id", "exception_key", "id"].includes(key)))).toBe(true);
  });

  it("retrieves original punches and added punches moved into the period, including their latest changes", async () => {
    const { client } = database({
      staff: [person()],
      time_punches: [punch("old-punch", "2025-01-01T12:00:00Z")],
      time_punch_corrections: [
        correction("move-punch", { correction_type: "change_time", target_punch_id: "old-punch", corrected_punched_at: "2026-11-03T12:00:00Z" }),
        correction("old-added", { corrected_punched_at: "2025-01-01T20:00:00Z" }),
        correction("move-added", { correction_type: "change_time", target_correction_id: "old-added" }),
        correction("move-again", { correction_type: "change_time", target_correction_id: "old-added", corrected_punched_at: "2026-11-12T20:00:00Z", corrected_at: "2026-11-11T12:00:00Z" }),
      ],
    });
    const loaded = await loadStaffTimeclock(client, { staffId: STAFF, ...period });
    expect(loaded.punches.map((row) => row.id)).toEqual(["old-punch"]);
    expect(loaded.corrections).toHaveLength(4);
    expect(effectivePunches(loaded.punches, loaded.corrections).map((row) => row.at.toISOString())).toEqual(["2026-11-03T12:00:00.000Z", "2026-11-12T20:00:00.000Z"]);
  });

  it("fails closed if a later page cannot load", async () => {
    const { client } = database({ staff: [person()], time_punches: Array.from({ length: 1005 }, (_, index) => punch(String(index))) }, 500);
    await expect(loadTimeclockPeriod(client, { facilityId: FACILITY, ...period })).rejects.toThrow("later page unavailable");
  });
});
