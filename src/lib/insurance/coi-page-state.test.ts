import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceCoiFetchErrorBannerMessage,
  resolveInsuranceCoiOrganizationGapMessage,
} from "./coi-page-state";

describe("resolveInsuranceCoiOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceCoiOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization and no scoped data loaded", () => {
    expect(
      resolveInsuranceCoiOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsuranceCoiOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceCoiFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceCoiFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsuranceCoiFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table certificates_of_insurance",
      }),
    ).toBe("permission denied for table certificates_of_insurance");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceCoiFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });
});
