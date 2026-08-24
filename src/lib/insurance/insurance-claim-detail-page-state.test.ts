import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceClaimDetailFetchErrorBannerMessage,
  resolveInsuranceClaimDetailOrganizationGapMessage,
} from "./insurance-claim-detail-page-state";

describe("resolveInsuranceClaimDetailOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceClaimDetailOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsuranceClaimDetailOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped claim data is already on screen", () => {
    expect(
      resolveInsuranceClaimDetailOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceClaimDetailFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceClaimDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces named fetch failures after auth resolves", () => {
    expect(
      resolveInsuranceClaimDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not load this claim. Try again, or contact support if this persists.",
      }),
    ).toBe("Could not load this claim. Try again, or contact support if this persists.");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceClaimDetailFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Could not load this claim. Try again, or contact support if this persists.",
      }),
    ).toBeNull();
  });
});
