import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY,
  hasExecutiveStandupOrgScopedPackData,
  isExecutiveStandupOrganizationGapError,
  resolveExecutiveStandupFetchErrorBannerMessage,
  resolveExecutiveStandupOrganizationGapMessage,
} from "./standup-page-state";
import type { ExecutiveStandupLive } from "./standup";

const LIVE_WITH_FACILITIES: ExecutiveStandupLive = {
  generatedAt: "2026-08-20T18:00:00.000Z",
  weekOf: "2026-08-18",
  completedLastWeekStart: "2026-08-11",
  completedLastWeekEnd: "2026-08-17",
  facilities: [
    {
      facilityId: "fac-1",
      facilityName: "Homewood Lodge ALF",
      topConcern: "AR pressure",
      pressureScore: 42,
      metrics: {},
    },
  ],
};

describe("hasExecutiveStandupOrgScopedPackData", () => {
  it("returns false when live pack is absent", () => {
    expect(hasExecutiveStandupOrgScopedPackData(null)).toBe(false);
  });

  it("returns true when the live pack includes facility rows", () => {
    expect(hasExecutiveStandupOrgScopedPackData(LIVE_WITH_FACILITIES)).toBe(true);
  });
});

describe("resolveExecutiveStandupOrganizationGapMessage", () => {
  it("suppresses the gap while auth is still hydrating", () => {
    expect(
      resolveExecutiveStandupOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedPackData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization and no pack loaded", () => {
    expect(
      resolveExecutiveStandupOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedPackData: false,
      }),
    ).toBe(EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped pack data is already on screen", () => {
    expect(
      resolveExecutiveStandupOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedPackData: true,
      }),
    ).toBeNull();
  });
});

describe("isExecutiveStandupOrganizationGapError", () => {
  it("recognizes quiet and legacy organization gap strings", () => {
    expect(isExecutiveStandupOrganizationGapError(EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY)).toBe(true);
    expect(isExecutiveStandupOrganizationGapError("Organization missing on profile.")).toBe(true);
    expect(isExecutiveStandupOrganizationGapError("Could not load executive standup.")).toBe(false);
  });
});

describe("resolveExecutiveStandupFetchErrorBannerMessage", () => {
  it("suppresses quiet org gap copy from the crash banner", () => {
    expect(
      resolveExecutiveStandupFetchErrorBannerMessage({
        authLoading: false,
        fetchError: EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY,
      }),
    ).toBeNull();
  });

  it("suppresses the legacy org crash string", () => {
    expect(
      resolveExecutiveStandupFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("still surfaces real fetch failures when the pack loaded", () => {
    expect(
      resolveExecutiveStandupFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not load executive standup.",
      }),
    ).toBe("Could not load executive standup.");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveExecutiveStandupFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });
});
