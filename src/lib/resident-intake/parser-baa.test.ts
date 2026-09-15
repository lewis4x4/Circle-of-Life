import { describe, expect, it } from "vitest";

import { phiPolicyAllowsResidentIntake } from "./parser";

const routed = {
  allow_phi: true,
  default_provider: "anthropic",
  routing_json: { resident_record_intake: { provider: "anthropic", enabled: true } },
};

describe("phiPolicyAllowsResidentIntake — BAA attestation", () => {
  it("refuses a policy that allows PHI but records no BAA", () => {
    expect(phiPolicyAllowsResidentIntake(routed)).toBe(false);
    expect(phiPolicyAllowsResidentIntake({ ...routed, baa_reference: null, baa_verified_at: null })).toBe(false);
  });

  it("refuses a blank reference or a missing verification instant", () => {
    expect(phiPolicyAllowsResidentIntake({ ...routed, baa_reference: "   ", baa_verified_at: "2026-09-15T21:00:00.000Z" })).toBe(false);
    expect(phiPolicyAllowsResidentIntake({ ...routed, baa_reference: "BAA-2026-001", baa_verified_at: null })).toBe(false);
    expect(phiPolicyAllowsResidentIntake({ ...routed, baa_reference: "BAA-2026-001", baa_verified_at: "not a date" })).toBe(false);
  });

  it("allows PHI once the BAA is on record, with either Z or an offset", () => {
    expect(phiPolicyAllowsResidentIntake({ ...routed, baa_reference: "BAA-2026-001", baa_verified_at: "2026-09-15T21:00:00.000Z" })).toBe(true);
    expect(phiPolicyAllowsResidentIntake({ ...routed, baa_reference: "BAA-2026-001", baa_verified_at: "2026-09-15T17:00:00-04:00" })).toBe(true);
  });

  it("still requires allow_phi and provider routing alongside the BAA", () => {
    const attested = { baa_reference: "BAA-2026-001", baa_verified_at: "2026-09-15T21:00:00.000Z" };
    expect(phiPolicyAllowsResidentIntake({ ...routed, ...attested, allow_phi: false })).toBe(false);
    expect(phiPolicyAllowsResidentIntake({ ...routed, ...attested, routing_json: {} })).toBe(false);
  });
});
