import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
} from "@/lib/executive/executive-auth-page-state";
import {
  deriveSafetyBoardState,
  formatSafetyBoardPageSubtitle,
  resolveSafetyBoardFetchErrorBannerMessage,
  resolveSafetyBoardOrganizationGapMessage,
  SAFETY_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY,
} from "./safety-board-page-state";

describe("deriveSafetyBoardState", () => {
  it("requires facility scope before any load state", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: false,
        rowCount: 0,
      }),
    ).toBe("no_facility");
  });

  it("shows auth loading before organization is known", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: true,
        organizationId: null,
        loadState: "idle",
        hasFacility: true,
        rowCount: 0,
      }),
    ).toBe("auth_loading");
  });

  it("names the organization gap after auth resolves without an org", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: false,
        organizationId: null,
        loadState: "ready",
        hasFacility: true,
        rowCount: 0,
      }),
    ).toBe("no_organization");
  });

  it("shows data loading while the query is in flight", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "loading",
        hasFacility: true,
        rowCount: 0,
      }),
    ).toBe("loading");
  });

  it("surfaces fetch errors only after auth and org are ready", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "error",
        hasFacility: true,
        rowCount: 0,
      }),
    ).toBe("error");
  });

  it("keeps numeric zero distribution on an empty successful query", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: true,
        rowCount: 0,
      }),
    ).toBe("empty");
  });

  it("shows populated rows when scores return", () => {
    expect(
      deriveSafetyBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: true,
        rowCount: 2,
      }),
    ).toBe("populated");
  });
});

describe("resolveSafetyBoardOrganizationGapMessage", () => {
  it("suppresses the gap while auth is still hydrating", () => {
    expect(
      resolveSafetyBoardOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveSafetyBoardOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(SAFETY_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY);
    expect(SAFETY_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY).toBe(
      EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
    );
  });
});

describe("resolveSafetyBoardFetchErrorBannerMessage", () => {
  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveSafetyBoardFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Could not load safety scores. Confirm facility scope and retry.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    expect(
      resolveSafetyBoardFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not load safety scores. Confirm facility scope and retry.",
      }),
    ).toBe("Could not load safety scores. Confirm facility scope and retry.");
  });

  it("never surfaces the legacy organization crash string", () => {
    expect(
      resolveSafetyBoardFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });
});

describe("formatSafetyBoardPageSubtitle", () => {
  it("uses the resolved facility scope label in the subtitle", () => {
    expect(formatSafetyBoardPageSubtitle("No facility name posted")).toContain(
      "No facility name posted",
    );
    expect(formatSafetyBoardPageSubtitle("Anon Facility A")).toContain("Anon Facility A");
  });
});
