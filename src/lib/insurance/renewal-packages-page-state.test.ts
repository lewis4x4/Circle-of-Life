import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceRenewalPackagesFetchErrorBannerMessage,
  resolveInsuranceRenewalPackagesOrganizationGapMessage,
} from "./renewal-packages-page-state";

describe("resolveInsuranceRenewalPackagesOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceRenewalPackagesOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsuranceRenewalPackagesOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsuranceRenewalPackagesOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceRenewalPackagesFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceRenewalPackagesFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsuranceRenewalPackagesFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table renewal_data_packages",
      }),
    ).toBe("permission denied for table renewal_data_packages");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceRenewalPackagesFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table renewal_data_packages",
      }),
    ).toBeNull();
  });
});
