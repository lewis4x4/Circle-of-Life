import { describe, expect, it } from "vitest";

import {
  buildAggregateSnapshotQuery,
  buildFacilitySnapshotQuery,
} from "@/lib/executive/metric-snapshot-queries";

function makeSupabaseMock() {
  const calls: Array<[string, ...unknown[]]> = [];

  const builder = {
    select(columns: string) {
      calls.push(["select", columns]);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push(["eq", column, value]);
      return builder;
    },
    is(column: string, value: unknown) {
      calls.push(["is", column, value]);
      return builder;
    },
    not(column: string, op: string, value: unknown) {
      calls.push(["not", column, op, value]);
      return builder;
    },
    order(column: string, opts: unknown) {
      calls.push(["order", column, opts]);
      return builder;
    },
    limit(value: number) {
      calls.push(["limit", value]);
      return builder;
    },
  };

  return {
    calls,
    supabase: {
      from(table: string) {
        calls.push(["from", table]);
        return builder;
      },
    },
  };
}

describe("metric snapshot query builders", () => {
  it("applies entity_id IS NULL to aggregate snapshot query", () => {
    const { calls, supabase } = makeSupabaseMock();

    buildAggregateSnapshotQuery(supabase as never, "org-1");

    expect(calls).toContainEqual(["is", "entity_id", null]);
    expect(calls).toContainEqual(["is", "facility_id", null]);
  });

  it("builds facility snapshot query without aggregate entity filter", () => {
    const { calls, supabase } = makeSupabaseMock();

    buildFacilitySnapshotQuery(supabase as never, "org-1");

    expect(calls).toContainEqual(["not", "facility_id", "is", null]);
    expect(calls).not.toContainEqual(["is", "entity_id", null]);
  });
});
