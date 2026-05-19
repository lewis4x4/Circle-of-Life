import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/client";
import { getRecurringTags } from "./deficiency-analysis";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

type DeficiencyRow = {
  id: string;
  tag_number: string;
  tag_description: string;
  survey_date: string;
  severity: string;
  status: string;
  corrected_at: string | null;
  verified_at: string | null;
};

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};
function createMockSupabase(results: QueryResult[]) {
  const surveyQueryLog: Array<{
    filters: Record<string, unknown>;
    ranges: Array<{ start: number; end: number }>;
    orders: string[];
  }> = [];

  class QueryBuilder {
    private filters: Record<string, unknown> = {};
    private ranges: Array<{ start: number; end: number }> = [];
    private orders: string[] = [];

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters[`eq:${column}`] = value;
      return this;
    }

    gte(column: string, value: unknown) {
      this.filters[`gte:${column}`] = value;
      return this;
    }

    is(column: string, value: unknown) {
      this.filters[`is:${column}`] = value;
      return this;
    }

    in(column: string, value: unknown) {
      this.filters[`in:${column}`] = value;
      return this;
    }

    order(column: string) {
      this.orders.push(column);
      return this;
    }

    range(start: number, end: number) {
      this.ranges.push({ start, end });
      return this;
    }

    then(resolve: (value: QueryResult) => void, reject?: (reason?: unknown) => void) {
      surveyQueryLog.push({
        filters: { ...this.filters },
        ranges: [...this.ranges],
        orders: [...this.orders],
      });
      const result = results.shift();
      if (!result) {
        const error = new Error("Missing mocked query result");
        if (reject) {
          reject(error);
          return;
        }
        throw error;
      }
      resolve(result);
    }
  }

  return {
    client: {
      from(table: string) {
        if (table !== "survey_deficiencies") {
          throw new Error(`Unexpected table ${table}`);
        }
        return new QueryBuilder();
      },
    },
    surveyQueryLog,
  };
}

describe("getRecurringTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses constant two queries for multiple recurring tags", async () => {
    const initialRows = [
      { tag_number: "A100", tag_description: "Tag A" },
      { tag_number: "A100", tag_description: "Tag A" },
      { tag_number: "B200", tag_description: "Tag B" },
      { tag_number: "B200", tag_description: "Tag B" },
      { tag_number: "C300", tag_description: "Tag C" },
    ];

    const allHistoryRows: DeficiencyRow[] = [
      {
        id: "a-1",
        tag_number: "A100",
        tag_description: "Tag A",
        survey_date: "2024-01-01",
        severity: "high",
        status: "open",
        corrected_at: null,
        verified_at: null,
      },
      {
        id: "a-2",
        tag_number: "A100",
        tag_description: "Tag A",
        survey_date: "2025-01-01",
        severity: "high",
        status: "open",
        corrected_at: null,
        verified_at: null,
      },
      {
        id: "b-1",
        tag_number: "B200",
        tag_description: "Tag B",
        survey_date: "2023-01-10",
        severity: "medium",
        status: "open",
        corrected_at: null,
        verified_at: null,
      },
      {
        id: "b-2",
        tag_number: "B200",
        tag_description: "Tag B",
        survey_date: "2025-01-10",
        severity: "medium",
        status: "closed",
        corrected_at: "2025-01-11",
        verified_at: null,
      },
    ];

    const { client, surveyQueryLog } = createMockSupabase([
      { data: initialRows, error: null },
      { data: allHistoryRows, error: null },
    ]);

    vi.mocked(createClient).mockReturnValue(client as never);

    await getRecurringTags("facility-1", 24);

    expect(surveyQueryLog).toHaveLength(2);
    expect(surveyQueryLog[1].filters["in:tag_number"]).toEqual(["A100", "B200"]);
    expect(surveyQueryLog[0].ranges).toEqual([{ start: 0, end: 999 }]);
    expect(surveyQueryLog[1].ranges).toEqual([{ start: 0, end: 999 }]);
    expect(surveyQueryLog[0].orders).toEqual(["tag_number", "survey_date", "id"]);
    expect(surveyQueryLog[1].orders).toEqual(["tag_number", "survey_date", "id"]);
  });

  it("excludes non-recurring tags, includes occurrences/gaps/averages, sorted by total desc", async () => {
    const { client } = createMockSupabase([
      {
        data: [
          { tag_number: "A100", tag_description: "Tag A" },
          { tag_number: "A100", tag_description: "Tag A" },
          { tag_number: "A100", tag_description: "Tag A" },
          { tag_number: "B200", tag_description: "Tag B" },
          { tag_number: "B200", tag_description: "Tag B" },
          { tag_number: "C300", tag_description: "Tag C" },
        ],
        error: null,
      },
      {
        data: [
          {
            id: "a-1",
            tag_number: "A100",
            tag_description: "Tag A",
            survey_date: "2024-01-01",
            severity: "high",
            status: "open",
            corrected_at: null,
            verified_at: null,
          },
          {
            id: "a-2",
            tag_number: "A100",
            tag_description: "Tag A",
            survey_date: "2024-01-31",
            severity: "high",
            status: "open",
            corrected_at: null,
            verified_at: null,
          },
          {
            id: "a-3",
            tag_number: "A100",
            tag_description: "Tag A",
            survey_date: "2024-03-01",
            severity: "high",
            status: "closed",
            corrected_at: "2024-03-02",
            verified_at: null,
          },
          {
            id: "b-1",
            tag_number: "B200",
            tag_description: "Tag B",
            survey_date: "2024-02-01",
            severity: "medium",
            status: "open",
            corrected_at: null,
            verified_at: null,
          },
          {
            id: "b-2",
            tag_number: "B200",
            tag_description: "Tag B",
            survey_date: "2024-02-16",
            severity: "medium",
            status: "closed",
            corrected_at: "2024-02-17",
            verified_at: null,
          },
        ],
        error: null,
      },
    ]);

    vi.mocked(createClient).mockReturnValue(client as never);

    const result = await getRecurringTags("facility-1", 24);

    expect(result.map((row) => row.tag_number)).toEqual(["A100", "B200"]);
    expect(result[0].total_occurrences).toBe(3);
    expect(result[1].total_occurrences).toBe(2);
    expect(result[0].occurrences).toHaveLength(3);
    expect(result[0].occurrences[0].gap_days).toBeNull();
    expect(result[0].occurrences[1].gap_days).toBe(30);
    expect(result[0].occurrences[2].gap_days).toBe(30);
    expect(result[0].days_between_average).toBe(30);
  });

  it("keeps all-history semantics by including older rows from the bulk query", async () => {
    const { client } = createMockSupabase([
      {
        data: [
          { tag_number: "A100", tag_description: "Tag A" },
          { tag_number: "A100", tag_description: "Tag A" },
        ],
        error: null,
      },
      {
        data: [
          {
            id: "a-old",
            tag_number: "A100",
            tag_description: "Tag A",
            survey_date: "2021-01-01",
            severity: "high",
            status: "open",
            corrected_at: null,
            verified_at: null,
          },
          {
            id: "a-new",
            tag_number: "A100",
            tag_description: "Tag A",
            survey_date: "2025-01-01",
            severity: "high",
            status: "open",
            corrected_at: null,
            verified_at: null,
          },
        ],
        error: null,
      },
    ]);

    vi.mocked(createClient).mockReturnValue(client as never);

    const result = await getRecurringTags("facility-1", 24);

    expect(result).toHaveLength(1);
    expect(result[0].occurrences.map((o) => o.deficiency_id)).toEqual(["a-old", "a-new"]);
  });

  it("returns [] and skips bulk query when no recurring tags are found", async () => {
    const { client, surveyQueryLog } = createMockSupabase([
      {
        data: [
          { tag_number: "A100", tag_description: "Tag A" },
          { tag_number: "B200", tag_description: "Tag B" },
        ],
        error: null,
      },
    ]);

    vi.mocked(createClient).mockReturnValue(client as never);

    const result = await getRecurringTags("facility-1", 24);

    expect(result).toEqual([]);
    expect(surveyQueryLog).toHaveLength(1);
  });

  it("paginates both initial and bulk queries when page size is exceeded", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, idx) => ({
      tag_number: idx < 999 ? "A100" : "B200",
      tag_description: idx < 999 ? "Tag A" : "Tag B",
    }));

    const { client, surveyQueryLog } = createMockSupabase([
      { data: firstPage, error: null },
      { data: [{ tag_number: "A100", tag_description: "Tag A" }], error: null },
      {
        data: Array.from({ length: 1000 }, (_, idx) => ({
          id: `a-${idx + 1}`,
          tag_number: "A100",
          tag_description: "Tag A",
          survey_date: `2024-01-${String((idx % 28) + 1).padStart(2, "0")}`,
          severity: "high",
          status: "open",
          corrected_at: null,
          verified_at: null,
        })),
        error: null,
      },
      {
        data: [
          {
            id: "a-1001",
            tag_number: "A100",
            tag_description: "Tag A",
            survey_date: "2024-02-01",
            severity: "high",
            status: "closed",
            corrected_at: null,
            verified_at: null,
          },
        ],
        error: null,
      },
    ]);

    vi.mocked(createClient).mockReturnValue(client as never);

    const result = await getRecurringTags("facility-1", 24);

    expect(result).toHaveLength(1);
    expect(result[0].total_occurrences).toBe(1001);
    expect(surveyQueryLog).toHaveLength(4);
    expect(surveyQueryLog[0].ranges).toEqual([{ start: 0, end: 999 }]);
    expect(surveyQueryLog[1].ranges).toEqual([{ start: 1000, end: 1999 }]);
    expect(surveyQueryLog[2].ranges).toEqual([{ start: 0, end: 999 }]);
    expect(surveyQueryLog[3].ranges).toEqual([{ start: 1000, end: 1999 }]);
    expect(surveyQueryLog[0].orders).toEqual(["tag_number", "survey_date", "id"]);
    expect(surveyQueryLog[2].orders).toEqual(["tag_number", "survey_date", "id"]);
  });

  it("throws contextual error message when Supabase returns error", async () => {
    const { client } = createMockSupabase([
      {
        data: null,
        error: { message: "kaboom" },
      },
    ]);

    vi.mocked(createClient).mockReturnValue(client as never);

    await expect(getRecurringTags("facility-1", 24)).rejects.toThrow(
      "Failed to fetch recurring tags: kaboom",
    );
  });
});
