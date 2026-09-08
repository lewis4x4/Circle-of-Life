import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import { loadReferralActionSummary, loadReferralLeadRoster } from "./referrals-hub-bootstrap";

describe("complete scoped referral action reads", () => {
  it("walks every action cursor and repeats facility scope", async () => {
    const cursor = { created_at: "2026-09-08T12:00:00Z", id: "a" };
    const rpc = vi.fn().mockResolvedValueOnce({ data: { items: [{ id: "a", facility_id: "facility" }], next_cursor: cursor }, error: null })
      .mockResolvedValueOnce({ data: { items: [{ id: "b", facility_id: "facility" }], next_cursor: null }, error: null });
    const rows = await loadReferralActionSummary({ rpc } as unknown as SupabaseClient<Database>, "facility");
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rpc.mock.calls.map((call) => call[1].p_facility_id)).toEqual(["facility", "facility"]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_before_created_at: cursor.created_at, p_before_id: cursor.id, p_open_only: true });
  });
  it("fails on later-page denial, repeated cursor or wrong scope rather than calling missing work confirmed", async () => {
    const first = { data: { items: [], next_cursor: { id: "a", created_at: "2026-09-08T12:00:00Z" } }, error: null };
    for (const response of [{ data: null, error: new Error("denied") }, first, { data: { items: [{ facility_id: "other" }], next_cursor: null }, error: null }]) {
      const rpc = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(response);
      await expect(loadReferralActionSummary({ rpc } as unknown as SupabaseClient<Database>, "facility")).rejects.toThrow();
    }
  });
  it("reads a lead beyond a reduced server cap with stable ordering and all scope filters", async () => {
    const queries: { filters: unknown[][]; range: number[] }[] = [];
    const all = Array.from({ length: 401 }, (_, index) => ({ id: `lead-${index}` }));
    const client = { from: vi.fn(() => {
      const query = { filters: [] as unknown[][], range: [] as number[] }; queries.push(query);
      const builder = {
        select: () => builder,
        eq: (...args: unknown[]) => { query.filters.push(["eq", ...args]); return builder; },
        is: (...args: unknown[]) => { query.filters.push(["is", ...args]); return builder; },
        order: (...args: unknown[]) => { query.filters.push(["order", ...args]); return builder; },
        range: (from: number, to: number) => { query.range = [from, to]; return Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + 73)), error: null }); },
      };
      return builder;
    }) };
    const rows = await loadReferralLeadRoster(client as unknown as SupabaseClient<Database>, "facility");
    expect(rows).toHaveLength(401); expect(rows.at(-1)?.id).toBe("lead-400");
    expect(queries.at(-1)?.range[0]).toBe(401);
    for (const query of queries) expect(query.filters).toEqual([["eq", "facility_id", "facility"], ["is", "deleted_at", null], ["order", "id", { ascending: true }]]);
  });
});
