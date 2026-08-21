import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
} from "@/lib/executive/executive-auth-page-state";
import {
  deriveInsightsBoardState,
  formatInsightsBoardPageSubtitle,
  resolveInsightsBoardFetchErrorBannerMessage,
  resolveInsightsBoardOrganizationGapMessage,
  INSIGHTS_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY,
} from "./insights-board-page-state";

describe("deriveInsightsBoardState", () => {
  it("requires facility scope before any load state", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: false,
        visibleRowCount: 0,
        filterApplied: false,
      }),
    ).toBe("no_facility");
  });

  it("shows auth loading before organization is known", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: true,
        organizationId: null,
        loadState: "idle",
        hasFacility: true,
        visibleRowCount: 0,
        filterApplied: false,
      }),
    ).toBe("auth_loading");
  });

  it("names the organization gap after auth resolves without an org", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: null,
        loadState: "ready",
        hasFacility: true,
        visibleRowCount: 0,
        filterApplied: false,
      }),
    ).toBe("no_organization");
  });

  it("shows data loading while the query is in flight", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "loading",
        hasFacility: true,
        visibleRowCount: 0,
        filterApplied: false,
      }),
    ).toBe("loading");
  });

  it("surfaces fetch errors only after auth and org are ready", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "error",
        hasFacility: true,
        visibleRowCount: 0,
        filterApplied: false,
      }),
    ).toBe("error");
  });

  it("keeps numeric zero KPIs on an empty successful query", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: true,
        visibleRowCount: 0,
        filterApplied: false,
      }),
    ).toBe("empty");
  });

  it("names an empty filter when rows exist but none match", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: true,
        visibleRowCount: 0,
        filterApplied: true,
      }),
    ).toBe("empty_filtered");
  });

  it("shows populated rows when insights return", () => {
    expect(
      deriveInsightsBoardState({
        authLoading: false,
        organizationId: "org-anon-1",
        loadState: "ready",
        hasFacility: true,
        visibleRowCount: 2,
        filterApplied: false,
      }),
    ).toBe("populated");
  });
});

describe("resolveInsightsBoardOrganizationGapMessage", () => {
  it("suppresses the gap while auth is still hydrating", () => {
    expect(
      resolveInsightsBoardOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveInsightsBoardOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(INSIGHTS_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY);
    expect(INSIGHTS_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY).toBe(
      EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
    );
  });
});

describe("resolveInsightsBoardFetchErrorBannerMessage", () => {
  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveInsightsBoardFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Could not load Smart rounding insights. Confirm facility scope and retry.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures after auth resolves", () => {
    expect(
      resolveInsightsBoardFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not load Smart rounding insights. Confirm facility scope and retry.",
      }),
    ).toBe("Could not load Smart rounding insights. Confirm facility scope and retry.");
  });

  it("never surfaces the legacy organization crash string", () => {
    expect(
      resolveInsightsBoardFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });
});

describe("formatInsightsBoardPageSubtitle", () => {
  it("names an unstarted insight cycle when data is ready with zero rows", () => {
    expect(
      formatInsightsBoardPageSubtitle("Anon Facility A", {
        dataReady: true,
        insightCycleStarted: false,
      }),
    ).toContain("No insight cycle has started at Anon Facility A yet");
  });

  it("uses live activity copy when insights exist", () => {
    expect(
      formatInsightsBoardPageSubtitle("Anon Facility A", {
        dataReady: true,
        insightCycleStarted: true,
      }),
    ).toContain("Clinical pattern detection");
    expect(
      formatInsightsBoardPageSubtitle("Anon Facility A", {
        dataReady: true,
        insightCycleStarted: true,
      }),
    ).toContain("Anon Facility A");
  });

  it("keeps activity copy while data is still loading", () => {
    expect(
      formatInsightsBoardPageSubtitle("Anon Facility A", {
        dataReady: false,
        insightCycleStarted: false,
      }),
    ).toContain("Clinical pattern detection");
    expect(
      formatInsightsBoardPageSubtitle("Anon Facility A", {
        dataReady: false,
        insightCycleStarted: false,
      }),
    ).not.toContain("No insight cycle has started");
  });
});
