import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShiftCurrent } from "./useShiftCurrent";

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, errors: {} as Record<string, { message: string }>, pages: [] as Array<[string, number]>, filters: [] as Array<[string, number]> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "operator" } } }) },
  from: (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let single = false;
    let offset = 0;
    let size = 1000;
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return chain; },
      in: (key: string, values: unknown[]) => { mocks.filters.push([table, values.length]); filters.push(row => values.includes(row[key])); return chain; },
      gt: (key: string, value: string) => { filters.push(row => String(row[key]) > value); return chain; },
      gte: (key: string, value: string) => { filters.push(row => String(row[key]) >= value); return chain; },
      lt: (key: string, value: string) => { filters.push(row => String(row[key]) < value); return chain; },
      lte: (key: string, value: string) => { filters.push(row => String(row[key]) <= value); return chain; },
      limit: (count: number) => { size = count; return chain; },
      range: (from: number, to: number) => { offset = from; size = to - from + 1; mocks.pages.push([table, from]); return chain; },
      maybeSingle: () => { single = true; return chain; },
      then: (resolve: (value: { data: Row | Row[] | null; error: { message: string } | null }) => unknown) => {
        const rows = (mocks.tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(offset, offset + size);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: mocks.errors[table] ?? null }).then(resolve);
      },
    };
    return chain;
  },
}) }));

function pass(id: string, extra: Row = {}): Row {
  return {
    id, shift_id: "shift", resident_id: "resident", resident_medication_id: id,
    scheduled_time: new Date().toISOString(), status: "pending",
    resident_medications: { medication_name: "Fixture medication", strength: "10 mg", instructions: "Per order", status: "active", deleted_at: null, controlled_schedule: "non_controlled" },
    ...extra,
  };
}

describe("Operational medication queue reads", () => {
  beforeEach(() => {
    mocks.errors = {};
    mocks.pages = [];
    mocks.filters = [];
    mocks.tables = {
      med_tech_shifts: [{ id: "shift", user_id: "operator", facility_id: "facility", status: "active", shift_start: new Date(Date.now() - 3600000).toISOString(), shift_end: new Date(Date.now() + 3600000).toISOString(), clocked_in_at: new Date().toISOString() }],
      facilities: [{ id: "facility", name: "Fixture facility" }],
      user_profiles: [{ id: "operator", full_name: "Fixture operator" }],
      med_tech_shift_residents: [{ id: "assignment", shift_id: "shift", resident_id: "resident", residents: { id: "resident", first_name: "Fixture", last_name: "Resident", status: "active", facility_id: "facility", deleted_at: null } }],
      med_passes: [pass("dose")], emar_records: [], shift_tape_events: [], pre_pass_holds: [],
    };
  });
  it("excludes expired shifts from the current cockpit", async () => {
    mocks.tables.med_tech_shifts[0].shift_end = new Date(Date.now() - 1000).toISOString();
    const { result } = renderHook(() => useShiftCurrent());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("No active shift");
  });
  it("hides doses documented elsewhere, inactive orders and departed residents", async () => {
    const resolved = pass("documented");
    mocks.tables.med_passes.push(resolved, pass("stopped", { resident_medications: { status: "discontinued" } }), pass("departed", { resident_id: "departed" }));
    mocks.tables.med_tech_shift_residents.push({ id: "old-assignment", shift_id: "shift", resident_id: "departed", residents: { id: "departed", status: "discharged", facility_id: "facility" } });
    mocks.tables.emar_records.push({ resident_medication_id: "documented", scheduled_time: resolved.scheduled_time, status: "given", facility_id: "facility" });
    const { result } = renderHook(() => useShiftCurrent());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.passes.map(row => row.id)).toEqual(["dose"]);
    expect(result.current.residents.map(row => row.id)).toEqual(["resident"]);
  });
  it("reads every page of generated passes", async () => {
    mocks.tables.med_passes = Array.from({ length: 501 }, (_, index) => pass(`dose-${index}`));
    const { result } = renderHook(() => useShiftCurrent());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.passes).toHaveLength(501);
    expect(mocks.pages).toContainEqual(["med_passes", 500]);
    expect(mocks.filters.filter(([table]) => table === "emar_records")).toHaveLength(6);
    expect(mocks.filters.every(([, length]) => length <= 100)).toBe(true);
  });
  it("shows an eMAR retrieval failure instead of offering already resolved doses", async () => {
    mocks.errors.emar_records = { message: "Dose evidence unavailable" };
    const { result } = renderHook(() => useShiftCurrent());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Dose evidence unavailable");
  });
});
