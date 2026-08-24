import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceClaimsFetchErrorBannerMessage,
  resolveInsuranceClaimsOrganizationGapMessage,
} from "./claims-list-page-state";

describe("resolveInsuranceClaimsOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceClaimsOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsuranceClaimsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsuranceClaimsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceClaimsFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceClaimsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsuranceClaimsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table insurance_claims",
      }),
    ).toBe("permission denied for table insurance_claims");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceClaimsFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table insurance_claims",
      }),
    ).toBeNull();
  });
});
