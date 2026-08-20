import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
  isExecutiveOrganizationGapError,
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "./executive-auth-page-state";

describe("resolveExecutiveOrganizationGapMessage", () => {
  it("suppresses the gap while auth is still hydrating", () => {
    expect(
      resolveExecutiveOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization and no scoped data loaded", () => {
    expect(
      resolveExecutiveOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped data is already on screen", () => {
    expect(
      resolveExecutiveOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("isExecutiveOrganizationGapError", () => {
  it("recognizes quiet and legacy organization gap strings", () => {
    expect(isExecutiveOrganizationGapError(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY)).toBe(true);
    expect(isExecutiveOrganizationGapError("Organization missing on profile.")).toBe(true);
    expect(isExecutiveOrganizationGapError("Could not load executive standup.")).toBe(false);
  });
});

describe("resolveExecutiveFetchErrorBannerMessage", () => {
  it("suppresses quiet org gap copy from the crash banner", () => {
    expect(
      resolveExecutiveFetchErrorBannerMessage({
        authLoading: false,
        fetchError: EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
      }),
    ).toBeNull();
  });

  it("suppresses the legacy org crash string", () => {
    expect(
      resolveExecutiveFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("still surfaces real fetch failures", () => {
    expect(
      resolveExecutiveFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not load executive standup.",
      }),
    ).toBe("Could not load executive standup.");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveExecutiveFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });
});
