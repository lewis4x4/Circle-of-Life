import { describe, expect, it, vi } from "vitest";

import { loadFinanceOverviewData } from "./load-finance-overview-data";

function createQuery(result: object, gte: (column: string, value: string) => unknown) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn((column: string, value: string) => {
      gte(column, value);
      return query;
    }),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (resolve: (value: object) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe("loadFinanceOverviewData", () => {
  it("anchors the one-month posted-entry lookback to the Eastern calendar", async () => {
    const gte = vi.fn();
    const queries = [
      createQuery({ count: 0 }, gte),
      createQuery({ count: 0 }, gte),
      createQuery({ data: [], error: null }, gte),
    ];
    let queryIndex = 0;
    const supabase = { from: vi.fn(() => queries[queryIndex++]) };

    const snapshot = await loadFinanceOverviewData(
      supabase as never,
      "00000000-0000-4000-8000-000000000001",
      new Date("2026-08-20T20:05:00-04:00"),
    );

    expect(gte).toHaveBeenCalledWith("entry_date", "2026-07-20");
    expect(gte).not.toHaveBeenCalledWith("entry_date", "2026-07-21");
    expect(snapshot.postedLookbackStart).toBe("2026-07-20");
  });
});

describe("loadFinanceOverviewData failed counts (COL-649)", () => {
  function supabaseWith(results: object[]) {
    const queries = results.map((result) => createQuery(result, () => undefined));
    let queryIndex = 0;
    return { from: vi.fn(() => queries[queryIndex++]) };
  }

  it("returns null counts, not 0, when the count reads fail", async () => {
    const snapshot = await loadFinanceOverviewData(
      supabaseWith([
        { count: null, error: { message: "column does not exist" } },
        { count: null, error: { message: "permission denied" } },
        { data: [], error: null },
      ]) as never,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(snapshot.postedCount).toBeNull();
    expect(snapshot.unpostedInvoices).toBeNull();
    expect(snapshot.sentInvoices).toBeNull();
  });

  it("keeps real zeros when the reads succeed", async () => {
    const snapshot = await loadFinanceOverviewData(
      supabaseWith([{ count: 0, error: null }, { count: 0, error: null }, { data: [], error: null }]) as never,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(snapshot.postedCount).toBe(0);
    expect(snapshot.unpostedInvoices).toBe(0);
    expect(snapshot.sentInvoices).toBe(0);
  });
});
