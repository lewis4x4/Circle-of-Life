import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchLiveBoardEscalations,
  fetchLiveBoardRoster,
  fetchLiveBoardShifts,
  fetchLiveBoardTasks,
  fetchLiveBoardWindows,
} from "./live-board-fetch";

type Call = {
  table?: string;
  select?: string;
  filters: Array<[string, string, unknown]>;
  orders: string[];
};

function client(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    const chain = {
      select(columns: string) {
        call.select = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        call.filters.push(["eq", column, value]);
        return chain;
      },
      is(column: string, value: unknown) {
        call.filters.push(["is", column, value]);
        return chain;
      },
      in(column: string, value: unknown) {
        call.filters.push(["in", column, value]);
        return chain;
      },
      gte(column: string, value: unknown) {
        call.filters.push(["gte", column, value]);
        return chain;
      },
      lte(column: string, value: unknown) {
        call.filters.push(["lte", column, value]);
        return chain;
      },
      order(column: string) {
        call.orders.push(column);
        return chain;
      },
      limit() {
        return chain;
      },
      then(resolve: (value: typeof result) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  };
  const rpc = vi.fn(() => Promise.resolve(result));
  const supabase = {
    from(table: string) {
      const call: Call = { table, filters: [], orders: [] };
      calls.push(call);
      return builder(call);
    },
    rpc,
  } as unknown as SupabaseClient;
  return { supabase, calls, rpc };
}

const EMPTY = { data: [], error: null };

/**
 * The three query defects spec decision D23 records, as assertions.
 *
 * The spec blamed three failing tabs on facility scoping. They were three
 * distinct query bugs, and the two shapes behind them are easy to reintroduce
 * from memory because both read naturally and neither works:
 * `residents.room_number` looks like a column and is not one, and a bare
 * `staff(...)` embed looks unambiguous and is not, because
 * `resident_observation_tasks` holds two foreign keys to `staff`.
 */
describe("Live board reads", () => {
  it("never asks residents for a room_number column, because there is not one", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchLiveBoardTasks(supabase, "facility-1", "2026-09-16", "2026-09-17");
    await fetchLiveBoardRoster(supabase, "facility-1");
    for (const call of calls) {
      expect(call.select).not.toMatch(/residents\s*\([^)]*room_number/);
    }
  });

  it("reaches room through the bed to room join, with the bed embed disambiguated", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchLiveBoardRoster(supabase, "facility-1");
    expect(calls[0].select).toContain("beds!residents_bed_id_fkey(rooms(room_number))");
  });

  it("names the constraint on the staff embed, which two foreign keys make ambiguous", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchLiveBoardTasks(supabase, "facility-1", "2026-09-16", "2026-09-17");
    expect(calls[0].select).toContain(
      "staff!resident_observation_tasks_assigned_staff_id_fkey(first_name, last_name, preferred_name)",
    );
    // The alias-prefixed form names a relation that does not exist.
    expect(calls[0].select).not.toContain("staff:assigned_staff_id");
  });

  it("filters every read by the selected facility", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchLiveBoardTasks(supabase, "facility-1", "2026-09-16", "2026-09-17");
    await fetchLiveBoardRoster(supabase, "facility-1");
    await fetchLiveBoardEscalations(supabase, "facility-1");
    await fetchLiveBoardShifts(supabase, "facility-1");
    for (const call of calls) {
      expect(call.filters).toContainEqual(["eq", "facility_id", "facility-1"]);
    }
  });

  it("asks the roster for active residents only, which is the population checks generate for", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchLiveBoardRoster(supabase, "facility-1");
    expect(calls[0].filters).toContainEqual(["eq", "status", "active"]);
    expect(calls[0].filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("does not filter watch or escalation reads on a deleted_at column they may not hold", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchLiveBoardShifts(supabase, "facility-1");
    // `facility_shift_definitions` does carry `deleted_at`; this asserts the
    // read only claims columns the table has.
    expect(calls[0].select).toBe("shift_key, label, starts_at_local, ends_at_local");
  });

  it("reads the windows in force through the projector, not off the window table", async () => {
    const { supabase, rpc } = client(EMPTY);
    await fetchLiveBoardWindows(supabase, "facility-1", "2026-09-17");
    expect(rpc).toHaveBeenCalledWith("facility_observation_windows_for_date", {
      p_facility_id: "facility-1",
      p_service_date: "2026-09-17",
    });
  });

  it("throws the underlying error so the caller can log its code", async () => {
    const { supabase } = client({ data: null, error: { code: "42703", message: "no such column" } });
    await expect(fetchLiveBoardRoster(supabase, "facility-1")).rejects.toMatchObject({
      code: "42703",
    });
  });
});
