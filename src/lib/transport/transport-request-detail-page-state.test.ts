import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { TRANSPORT_REQUEST_DETAIL_WAITING_PROFILE_SUBMIT_COPY } from "./transport-request-detail-display-copy";
import {
  isTransportRequestDetailSignInGapError,
  isTransportRequestDetailSubmitBlocked,
  resolveTransportRequestDetailEffectiveOrganizationId,
  resolveTransportRequestDetailFetchErrorBannerMessage,
  resolveTransportRequestDetailOrganizationGapMessage,
  resolveTransportRequestDetailSignInGapMessage,
  resolveTransportRequestDetailSubmitButtonLabel,
} from "./transport-request-detail-page-state";

describe("resolveTransportRequestDetailOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveTransportRequestDetailOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveTransportRequestDetailOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped request data is already loaded", () => {
    expect(
      resolveTransportRequestDetailOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveTransportRequestDetailSignInGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveTransportRequestDetailSignInGapMessage({
        authLoading: true,
        user: null,
      }),
    ).toBeNull();
  });

  it("names the sign-in gap when auth resolved without a user", () => {
    expect(
      resolveTransportRequestDetailSignInGapMessage({
        authLoading: false,
        user: null,
      }),
    ).toBe("Sign in to save");
  });
});

describe("resolveTransportRequestDetailFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveTransportRequestDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("suppresses legacy sign-in crash strings", () => {
    expect(
      resolveTransportRequestDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Sign in required.",
      }),
    ).toBeNull();
  });

  it("surfaces real save failures", () => {
    expect(
      resolveTransportRequestDetailFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table resident_transport_requests",
      }),
    ).toBe("permission denied for table resident_transport_requests");
  });
});

describe("isTransportRequestDetailSignInGapError", () => {
  it("recognizes quiet and legacy sign-in gap strings", () => {
    expect(isTransportRequestDetailSignInGapError("Sign in to save")).toBe(true);
    expect(isTransportRequestDetailSignInGapError("Sign in required.")).toBe(true);
    expect(isTransportRequestDetailSignInGapError("Could not save.")).toBe(false);
  });
});

describe("resolveTransportRequestDetailEffectiveOrganizationId", () => {
  it("prefers the hydrated profile organization", () => {
    expect(
      resolveTransportRequestDetailEffectiveOrganizationId("org-profile", "org-row"),
    ).toBe("org-profile");
  });

  it("falls back to the loaded request organization", () => {
    expect(resolveTransportRequestDetailEffectiveOrganizationId(null, "org-row")).toBe("org-row");
  });
});

describe("isTransportRequestDetailSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    user: { id: "usr-1" },
    effectiveOrganizationId: "org-1",
    facilityReady: true,
    hasRow: true,
  };

  it("blocks while auth hydrates", () => {
    expect(isTransportRequestDetailSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when sign-in is missing after auth", () => {
    expect(isTransportRequestDetailSubmitBlocked({ ...ready, user: null })).toBe(true);
  });

  it("blocks when no organization context is available", () => {
    expect(isTransportRequestDetailSubmitBlocked({ ...ready, effectiveOrganizationId: null })).toBe(true);
  });

  it("allows submit when profile and request context are present", () => {
    expect(isTransportRequestDetailSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveTransportRequestDetailSubmitButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(
      resolveTransportRequestDetailSubmitButtonLabel({
        saving: false,
        authLoading: true,
        user: null,
        effectiveOrganizationId: null,
      }),
    ).toBe(TRANSPORT_REQUEST_DETAIL_WAITING_PROFILE_SUBMIT_COPY);
  });

  it("names sign-in when auth resolved without a user", () => {
    expect(
      resolveTransportRequestDetailSubmitButtonLabel({
        saving: false,
        authLoading: false,
        user: null,
        effectiveOrganizationId: "org-1",
      }),
    ).toBe("Sign in to save");
  });
});
