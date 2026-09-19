import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceRenewalsFetchErrorBannerMessage,
  resolveInsuranceRenewalsOrganizationGapMessage,
} from "./renewals-page-state";

describe("resolveInsuranceRenewalsOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceRenewalsOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsuranceRenewalsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsuranceRenewalsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceRenewalsFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceRenewalsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsuranceRenewalsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table insurance_renewals",
      }),
    ).toBe("permission denied for table insurance_renewals");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceRenewalsFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table insurance_renewals",
      }),
    ).toBeNull();
  });
});
