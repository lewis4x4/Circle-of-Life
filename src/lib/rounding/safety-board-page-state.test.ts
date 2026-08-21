import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
} from "@/lib/executive/executive-auth-page-state";
import {
  deriveSafetyBoardState,
  formatSafetyBoardPageSubtitle,
  formatSafetyBoardUnexpectedFetchError,
  resolveSafetyBoardFetchErrorBannerMessage,
  resolveSafetyBoardOrganizationGapMessage,
  SAFETY_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY,
} from "./safety-board-page-state";
import { SAFETY_BOARD_NO_FACILITY_SCOPE_COPY, SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY } from "./safety-board-display-copy";

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
        fetchError: SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY,
      }),
    ).toBe(SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY);
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

describe("formatSafetyBoardUnexpectedFetchError", () => {
  it("does not ask the operator to confirm facility scope", () => {
    expect(formatSafetyBoardUnexpectedFetchError()).toBe(SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY);
    expect(formatSafetyBoardUnexpectedFetchError()).not.toContain("Confirm facility scope");
  });
});

describe("formatSafetyBoardPageSubtitle", () => {
  it("uses top-bar filter copy when no facility is selected", () => {
    const subtitle = formatSafetyBoardPageSubtitle({ kind: "unscoped" });
    expect(subtitle).toContain("per facility");
    expect(subtitle).toContain("top-bar facility filter");
    expect(subtitle).not.toContain("at No facility name posted");
    expect(subtitle).not.toMatch(/\bat\b/);
  });

  it("uses at-facility copy when the facility name is resolved", () => {
    expect(formatSafetyBoardPageSubtitle({ kind: "named", name: "Anon Facility A" })).toContain(
      "at Anon Facility A",
    );
  });

  it("uses a stand-alone missing-name gap instead of at-facility interpolation", () => {
    const subtitle = formatSafetyBoardPageSubtitle({ kind: "missing_name" });
    expect(subtitle).toContain(SAFETY_BOARD_NO_FACILITY_SCOPE_COPY);
    expect(subtitle).not.toContain("at No facility name posted");
    expect(subtitle).not.toMatch(/\bat No facility name posted\b/);
  });
});
