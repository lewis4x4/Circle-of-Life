import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";
import type { Database } from "@/types/database";

import { fetchExecRegisterCoverage, registerCountState } from "./register-coverage";

function fakeClient(counts: Record<string, { count: number | null; error?: unknown }>) {
  return {
    from(table: string) {
      const reply = { count: counts[table]?.count ?? null, error: counts[table]?.error ?? null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "in", "limit"]) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(reply).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("officer register counts (COL-649)", () => {
  it("a zero from a register that never held a record is 'Nothing recorded yet'", () => {
    const state = registerCountState({ loading: false, count: 0, registerRecorded: false });
    expect(state && formatMetric(state)).toBe("Nothing recorded yet");
  });

  it("a zero from a register in use stays 0", () => {
    const state = registerCountState({ loading: false, count: 0, registerRecorded: true });
    expect(state && formatMetric(state)).toBe("0");
  });

  it("an unknown register falls back to the count as read", () => {
    const state = registerCountState({ loading: false, count: 2, registerRecorded: null });
    expect(state && formatMetric(state)).toBe("2");
  });

  it("reads coverage and open escalations; a failed check is unknown, not 'none'", async () => {
    const coverage = await fetchExecRegisterCoverage(
      fakeClient({
        survey_deficiencies: { count: 0 },
        medication_errors: { count: null, error: { message: "400" } },
        infection_outbreaks: { count: 3 },
        resident_observation_escalations: { count: 1902 },
      }),
      "org",
      { facilityIds: ["a", "b"] },
    );
    expect(coverage).toEqual({
      surveyDeficienciesRecorded: false,
      medicationErrorsRecorded: null,
      outbreaksRecorded: true,
      openRoundingEscalations: 1902,
    });
  });
});
