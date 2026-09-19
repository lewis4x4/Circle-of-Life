import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cancelMonitoringOrder,
  fetchActiveMonitoringOrders,
  fetchClosedMonitoringOrders,
  fetchMonitoringOrderResidents,
} from "./monitoring-orders-list";

type Call = {
  table?: string;
  select?: string;
  filters: Array<[string, string, unknown]>;
  limited: boolean;
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
      order() {
        return chain;
      },
      limit() {
        call.limited = true;
        return chain;
      },
      then(resolve: (value: typeof result) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return chain;
  };
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const supabase = {
    from(table: string) {
      const call: Call = { table, filters: [], limited: false };
      calls.push(call);
      return builder(call);
    },
    rpc,
  } as unknown as SupabaseClient;
  return { supabase, calls, rpc };
}

const EMPTY = { data: [], error: null };

describe("Monitoring Order list reads", () => {
  it("scopes both reads to the selected building", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchActiveMonitoringOrders(supabase, "facility-1");
    await fetchClosedMonitoringOrders(supabase, "facility-1");
    for (const call of calls) {
      expect(call.filters).toContainEqual(["eq", "facility_id", "facility-1"]);
      expect(call.filters).toContainEqual(["is", "deleted_at", null]);
    }
  });

  it("names the constraint on the user_profiles embed, which three foreign keys make ambiguous", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchActiveMonitoringOrders(supabase, "facility-1");
    expect(calls[0].select).toContain(
      "user_profiles!resident_monitoring_orders_entered_by_fkey(full_name)",
    );
  });

  it("asks residents for room through the proven bed to room join", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchMonitoringOrderResidents(supabase, "facility-1", ["r1", "r1", "r2"]);
    expect(calls[0].table).toBe("residents");
    expect(calls[0].select).toContain("beds!residents_bed_id_fkey(rooms(room_number))");
    expect(calls[0].select).not.toContain("room_number,");
    expect(calls[0].filters).toContainEqual(["in", "id", ["r1", "r2"]]);
  });

  it("does not ask the database anything when there is no resident to ask about", async () => {
    const { supabase, calls } = client(EMPTY);
    expect(await fetchMonitoringOrderResidents(supabase, "facility-1", [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  /**
   * "Recent" is a row budget rather than a time window, so nothing in this
   * module holds a lookback literal. Spec decision D2.
   */
  it("bounds the closed list by a row count, not by a date", async () => {
    const { supabase, calls } = client(EMPTY);
    await fetchClosedMonitoringOrders(supabase, "facility-1");
    expect(calls[0].limited).toBe(true);
    expect(calls[0].filters.some(([operator]) => operator === "gte")).toBe(false);
  });

  it("stands an order down through the command, never with a direct update", async () => {
    const { supabase, rpc } = client(EMPTY);
    await cancelMonitoringOrder(supabase, "order-1", "Resident back to baseline");
    expect(rpc).toHaveBeenCalledWith("cancel_monitoring_order", {
      p_order_id: "order-1",
      p_reason: "Resident back to baseline",
    });
  });
});
