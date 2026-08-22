import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { DIETARY_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./dietary-new-display-copy";
import {
  isDietaryNewSubmitBlocked,
  resolveDietaryNewFetchErrorBannerMessage,
  resolveDietaryNewOrganizationGapMessage,
  resolveDietaryNewSubmitButtonLabel,
} from "./dietary-new-page-state";

describe("resolveDietaryNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveDietaryNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveDietaryNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("resolveDietaryNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveDietaryNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveDietaryNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table diet_orders",
      }),
    ).toBe("permission denied for table diet_orders");
  });
});

describe("isDietaryNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "org-anon-1",
    facilityReady: true,
    residentId: "res-anon-1",
  };

  it("blocks while auth hydrates", () => {
    expect(isDietaryNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isDietaryNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("allows submit when org, facility, and resident are present", () => {
    expect(isDietaryNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveDietaryNewSubmitButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(resolveDietaryNewSubmitButtonLabel({ saving: false, authLoading: true })).toBe(
      DIETARY_NEW_WAITING_PROFILE_SUBMIT_COPY,
    );
  });
});
