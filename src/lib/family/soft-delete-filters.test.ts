/**
 * Regression test for the 2026-05-21 soft-delete sweep — guarantees the family
 * billing + family feed queries filter out rows where `deleted_at IS NOT NULL`,
 * so deleted residents / invoices / payments / incidents never surface in
 * family-facing UI.
 *
 * The test runs a Proxy-based Supabase mock that records every chained method
 * call per `from()` invocation, then asserts the soft-delete predicate is
 * present in the chain for each target table.
 */
import { describe, expect, it } from "vitest";

import { fetchFamilyBillingContext, fetchFamilyPaymentsList } from "@/lib/family/family-billing-data";
import { fetchFamilyHomeSnapshot } from "@/lib/family/family-feed";

type Call = { method: string; args: unknown[] };

function buildQuery(result: { data: unknown[]; error: null | { message: string } }): {
  proxy: unknown;
  calls: Call[];
} {
  const calls: Call[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (r: typeof result) => unknown) => resolve(result);
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return proxy;
        };
      },
    },
  );
  return { proxy, calls };
}

function makeMockSupabase(opts?: { linkRows?: unknown[] }) {
  const queries: Array<{ table: string; calls: Call[] }> = [];
  const linkRows = opts?.linkRows ?? [];

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }),
    },
    from: (table: string) => {
      const seed: unknown[] = table === "family_resident_links" ? linkRows : [];
      const { proxy, calls } = buildQuery({ data: seed, error: null });
      queries.push({ table, calls });
      return proxy;
    },
  };

  const hasSoftDeleteFilter = (table: string) =>
    queries
      .filter((q) => q.table === table)
      .some((q) =>
        q.calls.some(
          (c) =>
            c.method === "is" &&
            c.args.length >= 2 &&
            c.args[0] === "deleted_at" &&
            c.args[1] === null,
        ),
      );

  return { supabase: supabase as never, hasSoftDeleteFilter, queries };
}

describe("family billing queries filter soft-deleted rows", () => {
  it("invoices and payments both filter deleted_at IS NULL", async () => {
    const mock = makeMockSupabase();
    const res = await fetchFamilyBillingContext(mock.supabase);
    expect(res.ok).toBe(true);
    expect(mock.hasSoftDeleteFilter("invoices")).toBe(true);
    expect(mock.hasSoftDeleteFilter("payments")).toBe(true);
  });

  it("family payments list filters deleted_at IS NULL", async () => {
    const mock = makeMockSupabase();
    const res = await fetchFamilyPaymentsList(mock.supabase);
    expect(res.ok).toBe(true);
    expect(mock.hasSoftDeleteFilter("payments")).toBe(true);
  });
});

describe("family feed queries filter soft-deleted rows", () => {
  it("incidents, invoices, and staff notes filter deleted_at IS NULL", async () => {
    const mock = makeMockSupabase({
      linkRows: [
        { resident_id: "r-1", can_view_clinical: true, can_view_financial: true },
      ],
    });
    const res = await fetchFamilyHomeSnapshot(mock.supabase);
    expect(res.ok).toBe(true);
    expect(mock.hasSoftDeleteFilter("incidents")).toBe(true);
    expect(mock.hasSoftDeleteFilter("invoices")).toBe(true);
    expect(mock.hasSoftDeleteFilter("family_portal_messages")).toBe(true);
  });
});
