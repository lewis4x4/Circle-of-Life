import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsurancePoliciesFetchErrorBannerMessage,
  resolveInsurancePoliciesOrganizationGapMessage,
} from "./policies-page-state";

describe("resolveInsurancePoliciesOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsurancePoliciesOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsurancePoliciesOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsurancePoliciesOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsurancePoliciesFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsurancePoliciesFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsurancePoliciesFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table insurance_policies",
      }),
    ).toBe("permission denied for table insurance_policies");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsurancePoliciesFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table insurance_policies",
      }),
    ).toBeNull();
  });
});
