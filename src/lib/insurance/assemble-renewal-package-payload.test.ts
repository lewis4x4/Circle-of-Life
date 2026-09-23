import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import { assembleRenewalPackagePayload } from "./assemble-renewal-package-payload";

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };

/** Chainable stand-in: every filter returns the same builder; awaiting it yields the table's result. */
function fakeClient(results: Record<string, Result>) {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "gte", "lte"]) b[m] = () => b;
    b.then = (resolve: (r: Result) => unknown) => resolve(results[table]!);
    return b;
  };
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient<Database>;
}

const params = { organizationId: "org", entityId: "ent", periodStart: "2026-01-01", periodEnd: "2026-06-30" };

describe("assembleRenewalPackagePayload (COL-708)", () => {
  it("refuses an entity with no facilities instead of sending all-zero metrics", async () => {
    const res = await assembleRenewalPackagePayload(fakeClient({ facilities: { data: [], error: null } }), params);
    expect(res.ok).toBe(false);
  });

  it("refuses when a head count did not come back instead of submitting 0", async () => {
    const res = await assembleRenewalPackagePayload(
      fakeClient({
        facilities: { data: [{ id: "f1" }], error: null },
        residents: { count: null, error: null },
        incidents: { count: 2, error: null },
        staff: { count: 9, error: null },
        invoices: { data: [], error: null },
      }),
      params,
    );
    expect(res).toEqual({ ok: false, error: expect.stringContaining("active residents") });
  });

  it("assembles real counts, including real zeros", async () => {
    const res = await assembleRenewalPackagePayload(
      fakeClient({
        facilities: { data: [{ id: "f1" }], error: null },
        residents: { count: 34, error: null },
        incidents: { count: 0, error: null },
        staff: { count: 12, error: null },
        invoices: { data: [{ total: 100 }, { total: 250 }], error: null },
      }),
      params,
    );
    expect(res.ok && res.payload.metrics).toEqual({
      active_residents: 34,
      incidents_in_period: 0,
      active_staff: 12,
      invoice_total_cents: 350,
    });
  });
});
