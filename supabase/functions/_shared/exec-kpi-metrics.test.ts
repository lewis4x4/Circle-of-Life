import { assertEquals } from "jsr:@std/assert";

import { computeKpiForFacilityIds } from "./exec-kpi-metrics.ts";

type Op = { method: string; args: unknown[] };

function createFakeSupabase() {
  const byTable = new Map<string, Op[][]>();

  const addQueryOps = (table: string, ops: Op[]) => {
    const existing = byTable.get(table) ?? [];
    existing.push(ops);
    byTable.set(table, existing);
  };

  return {
    byTable,
    from(table: string) {
      const ops: Op[] = [];
      addQueryOps(table, ops);

      const query = {
        select: (...args: unknown[]) => {
          ops.push({ method: "select", args });
          return query;
        },
        eq: (...args: unknown[]) => {
          ops.push({ method: "eq", args });
          return query;
        },
        is: (...args: unknown[]) => {
          ops.push({ method: "is", args });
          return query;
        },
        in: (...args: unknown[]) => {
          ops.push({ method: "in", args });
          return query;
        },
        gt: (...args: unknown[]) => {
          ops.push({ method: "gt", args });
          return query;
        },
        gte: (...args: unknown[]) => {
          ops.push({ method: "gte", args });
          return query;
        },
        lte: (...args: unknown[]) => {
          ops.push({ method: "lte", args });
          return query;
        },
        lt: (...args: unknown[]) => {
          ops.push({ method: "lt", args });
          return query;
        },
        not: (...args: unknown[]) => {
          ops.push({ method: "not", args });
          return query;
        },
        order: (...args: unknown[]) => {
          ops.push({ method: "order", args });
          return query;
        },
        limit: (...args: unknown[]) => {
          ops.push({ method: "limit", args });
          return query;
        },
        then: (onFulfilled: (value: { data: unknown[]; count: number; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [], count: 0, error: null }).then(onFulfilled, onRejected),
      };

      return query;
    },
  };
}

Deno.test("incident query filters open incidents but not trailing incident-rate statuses", async () => {
  const supabase = createFakeSupabase();

  await computeKpiForFacilityIds(
    supabase as never,
    "00000000-0000-0000-0000-000000000123",
    [{ id: "facility-1", total_licensed_beds: 10 }],
    { snapshotDate: "2026-05-18" },
  );

  const incidentQueries = supabase.byTable.get("incidents") ?? [];
  assertEquals(incidentQueries.length, 2);

  const openIncidentsOps = incidentQueries[0] ?? [];
  const trailingRateOps = incidentQueries[1] ?? [];

  const openStatusFilter = openIncidentsOps.find((op) => op.method === "in" && op.args[0] === "status");
  assertEquals(openStatusFilter?.args[1], ["open", "investigating"]);

  const trailingStatusFilter = trailingRateOps.find((op) => op.method === "in" && op.args[0] === "status");
  assertEquals(trailingStatusFilter, undefined);
});
