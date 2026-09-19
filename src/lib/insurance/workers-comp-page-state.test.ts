import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceWorkersCompFetchErrorBannerMessage,
  resolveInsuranceWorkersCompOrganizationGapMessage,
} from "./workers-comp-page-state";

describe("resolveInsuranceWorkersCompOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceWorkersCompOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsuranceWorkersCompOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsuranceWorkersCompOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceWorkersCompFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceWorkersCompFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsuranceWorkersCompFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table workers_comp_claims",
      }),
    ).toBe("permission denied for table workers_comp_claims");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceWorkersCompFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table workers_comp_claims",
      }),
    ).toBeNull();
  });
});
