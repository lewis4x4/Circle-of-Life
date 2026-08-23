import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./transport-request-new-display-copy";
import {
  isTransportRequestNewSubmitBlocked,
  resolveTransportRequestNewFetchErrorBannerMessage,
  resolveTransportRequestNewOrganizationGapMessage,
  resolveTransportRequestNewSubmitButtonLabel,
} from "./transport-request-new-page-state";

describe("resolveTransportRequestNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveTransportRequestNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveTransportRequestNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("resolveTransportRequestNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveTransportRequestNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveTransportRequestNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table resident_transport_requests",
      }),
    ).toBe("permission denied for table resident_transport_requests");
  });
});

describe("isTransportRequestNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "org-anon-1",
    facilityReady: true,
    residentId: "res-anon-1",
  };

  it("blocks while auth hydrates", () => {
    expect(isTransportRequestNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isTransportRequestNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("allows submit when org, facility, and resident are present", () => {
    expect(isTransportRequestNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveTransportRequestNewSubmitButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(resolveTransportRequestNewSubmitButtonLabel({ saving: false, authLoading: true })).toBe(
      TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY,
    );
  });
});
