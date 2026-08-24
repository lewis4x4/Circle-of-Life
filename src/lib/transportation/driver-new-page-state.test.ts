import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { DRIVER_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./driver-new-display-copy";
import {
  isDriverNewSubmitBlocked,
  resolveDriverNewFetchErrorBannerMessage,
  resolveDriverNewOrganizationGapMessage,
  resolveDriverNewSubmitButtonLabel,
} from "./driver-new-page-state";

describe("resolveDriverNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveDriverNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveDriverNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("resolveDriverNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveDriverNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveDriverNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table driver_credentials",
      }),
    ).toBe("permission denied for table driver_credentials");
  });
});

describe("isDriverNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "org-anon-1",
    facilityReady: true,
    staffId: "staff-anon-1",
  };

  it("blocks while auth hydrates", () => {
    expect(isDriverNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isDriverNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("allows submit when org, facility, and staff are present", () => {
    expect(isDriverNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveDriverNewSubmitButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(resolveDriverNewSubmitButtonLabel({ saving: false, authLoading: true })).toBe(
      DRIVER_NEW_WAITING_PROFILE_SUBMIT_COPY,
    );
  });
});
