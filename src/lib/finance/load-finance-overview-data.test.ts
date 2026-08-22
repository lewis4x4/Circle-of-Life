import { describe, expect, it, vi } from "vitest";

import { loadFinanceOverviewData } from "./load-finance-overview-data";

function createQuery(result: object, gte: ReturnType<typeof vi.fn>) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn((column: string, value: string) => {
      gte(column, value);
      return query;
    }),
    is: vi.fn().mockReturnThis(),
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
