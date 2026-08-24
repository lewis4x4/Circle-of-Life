import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsurancePolicyDetailFetchErrorBannerMessage,
  resolveInsurancePolicyDetailOrganizationGapMessage,
} from "./insurance-policy-detail-page-state";

describe("resolveInsurancePolicyDetailOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsurancePolicyDetailOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsurancePolicyDetailOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped policy data is already on screen", () => {
    expect(
      resolveInsurancePolicyDetailOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsurancePolicyDetailFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsurancePolicyDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces named fetch failures after auth resolves", () => {
    expect(
      resolveInsurancePolicyDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not load this policy. Try again, or contact support if this persists.",
      }),
    ).toBe("Could not load this policy. Try again, or contact support if this persists.");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsurancePolicyDetailFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Could not load this policy. Try again, or contact support if this persists.",
      }),
    ).toBeNull();
  });
});
