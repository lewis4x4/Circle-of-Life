import { describe, expect, it } from "vitest";

import {
  insuranceHubKpiEmptyCopy,
  insuranceHubKpiTileValue,
  type InsuranceHubKpiContext,
} from "./hub-kpi-copy";

const ORG_ID = "a0000000-0000-4000-8000-000000000001";

function ctx(partial: Partial<InsuranceHubKpiContext> = {}): InsuranceHubKpiContext {
  return {
    organizationId: ORG_ID,
    loadFailed: false,
    ...partial,
  };
}

describe("insuranceHubKpiEmptyCopy", () => {
  it("names missing organization scope", () => {
    expect(insuranceHubKpiEmptyCopy("active_policies", ctx({ organizationId: null }))).toBe(
      "Organization not on profile",
    );
  });

  it("names a failed overview fetch", () => {
    expect(insuranceHubKpiEmptyCopy("renewals_in_flight", ctx({ loadFailed: true }))).toBe(
      "Insurance counts did not load",
    );
  });

  it("names per-metric load gaps when org is set but counts are absent", () => {
    expect(insuranceHubKpiEmptyCopy("active_policies", ctx())).toBe("Policy count not loaded yet");
    expect(insuranceHubKpiEmptyCopy("renewals_in_flight", ctx())).toBe("Renewal count not loaded yet");
    expect(insuranceHubKpiEmptyCopy("open_claims", ctx())).toBe("Claim count not loaded yet");
  });
});

describe("insuranceHubKpiTileValue", () => {
  it("keeps real zeros numeric", () => {
    expect(insuranceHubKpiTileValue("open_claims", 0, ctx())).toBe(0);
  });

  it("returns loaded counts unchanged", () => {
    expect(insuranceHubKpiTileValue("active_policies", 12, ctx())).toBe(12);
  });

  it("returns explicit copy when the count is null", () => {
    expect(insuranceHubKpiTileValue("active_policies", null, ctx())).toBe("Policy count not loaded yet");
    expect(insuranceHubKpiTileValue("renewals_in_flight", null, ctx({ organizationId: null }))).toBe(
      "Organization not on profile",
    );
    expect(insuranceHubKpiTileValue("open_claims", null, ctx({ loadFailed: true }))).toBe(
      "Insurance counts did not load",
    );
  });
});
