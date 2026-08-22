import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  deriveQualityHubState,
  QUALITY_HUB_UNEXPECTED_FETCH_ERROR_COPY,
  resolveQualityHubFetchErrorBannerMessage,
  resolveQualityHubOrganizationGapMessage,
  resolveQualityHubQueryErrorMessage,
} from "./quality-hub-page-state";

describe("deriveQualityHubState", () => {
  it("requires facility scope before any load state", () => {
    expect(
      deriveQualityHubState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: false,
      }),
    ).toBe("no_facility");
  });

  it("shows auth loading before organization is known", () => {
    expect(
      deriveQualityHubState({
        authLoading: true,
        organizationId: null,
        loadState: "idle",
        hasFacility: true,
      }),
    ).toBe("auth_loading");
  });

  it("names the organization gap after auth resolves without an org", () => {
    expect(
      deriveQualityHubState({
        authLoading: false,
        organizationId: null,
        loadState: "ready",
        hasFacility: true,
      }),
    ).toBe("no_organization");
  });

  it("shows data loading while the query is in flight", () => {
    expect(
      deriveQualityHubState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "loading",
        hasFacility: true,
      }),
    ).toBe("loading");
  });

  it("surfaces fetch errors only after auth and org are ready", () => {
    expect(
      deriveQualityHubState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "error",
        hasFacility: true,
      }),
    ).toBe("error");
  });
});

describe("resolveQualityHubOrganizationGapMessage", () => {
  it("suppresses the gap while auth hydrates", () => {
    expect(
      resolveQualityHubOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("returns quiet operator copy when auth resolved without an organization", () => {
    expect(
      resolveQualityHubOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveQualityHubOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveQualityHubFetchErrorBannerMessage", () => {
  it("does not treat the legacy org crash string as a fetch failure", () => {
    expect(
      resolveQualityHubFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    expect(
      resolveQualityHubFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table quality_measures",
      }),
    ).toBe("permission denied for table quality_measures");
  });
});

describe("resolveQualityHubQueryErrorMessage", () => {
  it("returns null when there is no query error", () => {
    expect(resolveQualityHubQueryErrorMessage(null)).toBeNull();
  });

  it("returns the error message for real failures", () => {
    expect(resolveQualityHubQueryErrorMessage(new Error("network timeout"))).toBe("network timeout");
  });

  it("falls back to the unexpected fetch copy for non-error values", () => {
    expect(resolveQualityHubQueryErrorMessage("oops")).toBe(QUALITY_HUB_UNEXPECTED_FETCH_ERROR_COPY);
  });
});
