import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveInsuranceLossRunsFetchErrorBannerMessage,
  resolveInsuranceLossRunsOrganizationGapMessage,
} from "./loss-runs-page-state";

describe("resolveInsuranceLossRunsOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveInsuranceLossRunsOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsuranceLossRunsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveInsuranceLossRunsOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveInsuranceLossRunsFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveInsuranceLossRunsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveInsuranceLossRunsFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table loss_runs",
      }),
    ).toBe("permission denied for table loss_runs");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsuranceLossRunsFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table loss_runs",
      }),
    ).toBeNull();
  });
});
