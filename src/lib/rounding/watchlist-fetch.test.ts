import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dispositionWatchlistSignal,
  fetchFacilityWatchlist,
  fetchResidentDispositionLedger,
  fetchWatchlistPortfolio,
} from "./watchlist-fetch";

type Call = { table?: string; select?: string; filters: Array<[string, unknown]>; orders: string[] };

function client(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    let start = 0;
    let end = 999;
    const chain = {
      range(from: number, to: number) { start = from; end = to; return chain; },
      select(columns: string) {
        call.select = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return chain;
      },
      is(column: string, value: unknown) {
        call.filters.push([column, value]);
        return chain;
      },
      order(column: string) {
        call.orders.push(column);
        return chain;
      },
      then(resolve: (value: typeof result) => unknown) {
        return Promise.resolve({ ...result, count: Array.isArray(result.data) ? result.data.length : 0, data: Array.isArray(result.data) ? result.data.slice(start, end + 1) : result.data }).then(resolve);
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

describe("Watchlist reads", () => {
  it("reads the portfolio from the facility level view, worst building first", async () => {
    const { supabase, calls } = client({ data: [{ facility_id: "f" }], error: null });
    const rows = await fetchWatchlistPortfolio(supabase);
    expect(rows).toHaveLength(1);
    expect(calls[0].table).toBe("v_watchlist_portfolio");
    expect(calls[0].orders).toEqual(["open_acute_signal_count", "facility_name", "facility_id"]);
  });

  it("asks the facility board for one building, ranked by band then age", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await fetchFacilityWatchlist(supabase, "facility-1");
    expect(calls[0].table).toBe("v_watchlist_facility");
    expect(calls[0].filters).toContainEqual(["facility_id", "facility-1"]);
    expect(calls[0].orders).toEqual(["band_rank", "first_detected_at", "signal_instance_id"]);
  });

  it("never asks for a resident safety score", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await fetchWatchlistPortfolio(supabase);
    await fetchFacilityWatchlist(supabase, "facility-1");
    await fetchResidentDispositionLedger(supabase, "resident-1");
    for (const call of calls) {
      expect(call.table).not.toBe("resident_safety_scores");
      expect(call.select ?? "").not.toContain("score");
    }
  });

  it("reads the ledger in append order rather than by timestamp", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await fetchResidentDispositionLedger(supabase, "resident-1");
    expect(calls[0].table).toBe("watchlist_signal_dispositions");
    expect(calls[0].orders).toEqual(["ledger_seq", "id"]);
  });

  it("surfaces a read failure rather than answering with an empty board", async () => {
    const { supabase } = client({ data: null, error: { code: "42501", message: "denied" } });
    await expect(fetchWatchlistPortfolio(supabase)).rejects.toMatchObject({ code: "42501" });
  });

  it("dispositions through the command, which writes the ledger row itself", async () => {
    const { supabase, rpc } = client({ data: null, error: null });
    await dispositionWatchlistSignal(supabase, {
      signalInstanceId: "instance-1",
      toStatus: "acknowledged",
      note: "Reviewed with the nurse on shift.",
    });
    expect(rpc).toHaveBeenCalledWith("disposition_watchlist_signal", {
      p_instance_id: "instance-1",
      p_to_status: "acknowledged",
      p_note: "Reviewed with the nurse on shift.",
    });
  });

  it("raises when the command refuses the caller", async () => {
    const { supabase } = client({ data: null, error: { code: "42501", message: "denied" } });
    await expect(
      dispositionWatchlistSignal(supabase, {
        signalInstanceId: "instance-1",
        toStatus: "cleared",
        note: "Closed.",
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("the ledger names who acted", () => {
  it("flattens the embedded profile onto the row", async () => {
    const { supabase } = client({
      data: [
        {
          id: "d1",
          ledger_seq: 2,
          signal_instance_id: "i1",
          signal_key: "repeat_fall",
          resident_id: "r1",
          from_status: "new",
          to_status: "acknowledged",
          note: "Reviewed.",
          actor_kind: "user",
          acted_by: "u1",
          acted_by_role: "facility_admin",
          acted_at: "2026-09-17T14:00:00.000Z",
          user_profiles: { full_name: "A Reviewer" },
        },
      ],
      error: null,
    });
    const rows = await fetchResidentDispositionLedger(supabase, "r1");
    expect(rows[0].acted_by_name).toBe("A Reviewer");
    expect("user_profiles" in rows[0]).toBe(false);
  });

  it("leaves a scheduled transition unnamed rather than guessing", async () => {
    const { supabase } = client({
      data: [
        {
          id: "d2",
          ledger_seq: 1,
          signal_instance_id: "i1",
          signal_key: "repeat_fall",
          resident_id: "r1",
          from_status: null,
          to_status: "new",
          note: null,
          actor_kind: "system",
          acted_by: null,
          acted_by_role: null,
          acted_at: "2026-09-17T13:00:00.000Z",
          user_profiles: null,
        },
      ],
      error: null,
    });
    const rows = await fetchResidentDispositionLedger(supabase, "r1");
    expect(rows[0].acted_by_name).toBeNull();
  });
});
