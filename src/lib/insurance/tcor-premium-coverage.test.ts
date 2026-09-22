import { describe, expect, it } from "vitest";

import { resolveTcorPremiumCoverage } from "./tcor-premium-coverage";

describe("resolveTcorPremiumCoverage", () => {
  it("says nothing when the window holds no policies", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 0, policiesWithStatedPremium: 0 });
    expect(c.disclosure).toBeNull();
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(false);
  });

  it("confirms coverage when every policy states a premium", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 4, policiesWithStatedPremium: 4 });
    expect(c.complete).toBe(true);
    expect(c.partial).toBe(false);
    expect(c.disclosure).toBe("Premium stated for all 4 policies in the window.");
  });

  it("reads naturally for a single fully-stated policy", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 1, policiesWithStatedPremium: 1 });
    expect(c.disclosure).toBe("Premium stated for the 1 policy in the window.");
  });

  // The COL production case this was written for: one property premium under
  // seventeen policies, with the master GL programme unallocated.
  it("names the shortfall when only some policies state a premium", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 17, policiesWithStatedPremium: 1 });
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(true);
    expect(c.disclosure).toBe(
      "Premium stated for 1 of 17 policies. This total covers only that policy — it is not the full programme cost.",
    );
  });

  it("pluralises the covered policies when more than one states a premium", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 17, policiesWithStatedPremium: 3 });
    expect(c.disclosure).toBe(
      "Premium stated for 3 of 17 policies. This total covers only those policies — it is not the full programme cost.",
    );
  });

  it("refuses to call a total a programme cost when nothing states a premium", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 17, policiesWithStatedPremium: 0 });
    expect(c.partial).toBe(true);
    expect(c.disclosure).toBe(
      "No premium is recorded for any of the 17 policies in the window. This total is not a cost of the insurance programme.",
    );
  });

  it("uses the singular when a lone policy states nothing", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 1, policiesWithStatedPremium: 0 });
    expect(c.disclosure).toBe(
      "No premium is recorded for any of the 1 policy in the window. This total is not a cost of the insurance programme.",
    );
  });

  it("never reports more stated premiums than the window holds", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: 3, policiesWithStatedPremium: 5 });
    expect(c.policiesWithStatedPremium).toBe(3);
    expect(c.complete).toBe(true);
  });

  it("clamps negative inputs rather than emitting nonsense", () => {
    const c = resolveTcorPremiumCoverage({ policiesInWindow: -2, policiesWithStatedPremium: -1 });
    expect(c.policiesInWindow).toBe(0);
    expect(c.policiesWithStatedPremium).toBe(0);
    expect(c.disclosure).toBeNull();
  });
});
