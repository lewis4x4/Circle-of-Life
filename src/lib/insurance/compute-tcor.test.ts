import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeTotalCostOfRisk } from "@/lib/insurance/compute-tcor";
import type { Database } from "@/types/database";

type QueryCall = { method: string; args: unknown[] };

function queryReturning(data: unknown[], calls: QueryCall[]) {
  const query = {
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return query;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return query;
    },
    is(...args: unknown[]) {
      calls.push({ method: "is", args });
      return query;
    },
    in(...args: unknown[]) {
      calls.push({ method: "in", args });
      return query;
    },
    lte(...args: unknown[]) {
      calls.push({ method: "lte", args });
      return query;
    },
    gte(...args: unknown[]) {
      calls.push({ method: "gte", args });
      return query;
    },
    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return query;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("computeTotalCostOfRisk", () => {
  it("anchors its rolling window to the Eastern facility calendar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T00:05:00.000Z")); // Aug 20 in Eastern time.

    const policyCalls: QueryCall[] = [];
    const claimCalls: QueryCall[] = [];
    const supabase = {
      from(table: string) {
        if (table === "insurance_policies") return queryReturning([], policyCalls);
        if (table === "insurance_claims") return queryReturning([], claimCalls);
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await computeTotalCostOfRisk(supabase, {
      organizationId: "00000000-0000-4000-8000-000000000001",
      entityId: null,
    });

    expect(result).toEqual({
      ok: true,
      snapshot: {
        periodStart: "2025-08-20",
        periodEnd: "2026-08-20",
        premiumsCents: 0,
        incurredLossesCents: 0,
        tcorCents: 0,
        policyRows: 0,
        policiesWithStatedPremium: 0,
        claimRows: 0,
      },
    });
    expect(policyCalls).toContainEqual({ method: "lte", args: ["effective_date", "2026-08-20"] });
    expect(policyCalls).toContainEqual({ method: "gte", args: ["expiration_date", "2025-08-20"] });
    expect(policyCalls).toContainEqual({ method: "in", args: ["status", ["active", "pending_renewal", "expired", "cancelled"]] });
  });

  // COL-526: the premium total and the policy count were shown side by side with
  // nothing saying how many of those policies the money actually came from.
  it("counts how many policies state a premium, separately from how many are in the window", async () => {
    const supabase = {
      from(table: string) {
        if (table === "insurance_policies") {
          return queryReturning(
            [
              { id: "a", premium_cents: 2402452, effective_date: "2026-07-14", expiration_date: "2027-07-14", status: "active" },
              // Null is the absence of a statement — this is the COL case, where
              // the master programme premium is recorded once, not per entity.
              { id: "b", premium_cents: null, effective_date: "2026-04-08", expiration_date: "2027-04-08", status: "active" },
              { id: "c", premium_cents: null, effective_date: "2026-04-08", expiration_date: "2027-04-08", status: "active" },
              // A recorded zero IS a statement about the premium, so it counts as
              // stated even though it adds nothing to the total.
              { id: "d", premium_cents: 0, effective_date: "2026-04-08", expiration_date: "2027-04-08", status: "active" },
            ],
            [],
          );
        }
        if (table === "insurance_claims") return queryReturning([], []);
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await computeTotalCostOfRisk(supabase, {
      organizationId: "00000000-0000-4000-8000-000000000001",
      entityId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.policyRows).toBe(4);
    expect(result.snapshot.policiesWithStatedPremium).toBe(2);
    expect(result.snapshot.premiumsCents).toBe(2402452);
  });
});
