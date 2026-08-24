import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  REPUTATION_ACCOUNT_NEW_LABEL_REQUIRED_SUBMIT_COPY,
  REPUTATION_ACCOUNT_NEW_SELECT_FACILITY_SUBMIT_COPY,
  REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "./reputation-account-new-display-copy";
import {
  isReputationAccountNewAuthGapError,
  isReputationAccountNewSubmitBlocked,
  resolveReputationAccountNewFetchErrorBannerMessage,
  resolveReputationAccountNewOrganizationGapMessage,
  resolveReputationAccountNewSubmitButtonLabel,
} from "./reputation-account-new-page-state";

describe("resolveReputationAccountNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveReputationAccountNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveReputationAccountNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("isReputationAccountNewAuthGapError", () => {
  it("recognizes quiet and legacy organization and sign-in gap strings", () => {
    expect(isReputationAccountNewAuthGapError(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY)).toBe(true);
    expect(isReputationAccountNewAuthGapError("Organization missing on profile.")).toBe(true);
    expect(isReputationAccountNewAuthGapError("Sign in required.")).toBe(true);
    expect(isReputationAccountNewAuthGapError("permission denied for table reputation_accounts")).toBe(false);
  });
});

describe("resolveReputationAccountNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization and sign-in crash strings", () => {
    expect(
      resolveReputationAccountNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
    expect(
      resolveReputationAccountNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Sign in required.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveReputationAccountNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table reputation_accounts",
      }),
    ).toBe("permission denied for table reputation_accounts");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveReputationAccountNewFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });
});

describe("isReputationAccountNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "org-anon-1",
    userId: "usr-anon-1",
    facilityReady: true,
    label: "Main campus Google",
  };

  it("blocks while auth hydrates", () => {
    expect(isReputationAccountNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isReputationAccountNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("blocks when user is missing after auth", () => {
    expect(isReputationAccountNewSubmitBlocked({ ...ready, userId: null })).toBe(true);
  });

  it("blocks when facility is not ready", () => {
    expect(isReputationAccountNewSubmitBlocked({ ...ready, facilityReady: false })).toBe(true);
  });

  it("blocks when label is blank", () => {
    expect(isReputationAccountNewSubmitBlocked({ ...ready, label: "   " })).toBe(true);
  });

  it("allows submit when org, user, facility, and label are present", () => {
    expect(isReputationAccountNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveReputationAccountNewSubmitButtonLabel", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "org-anon-1",
    userId: "usr-anon-1",
    facilityReady: true,
    label: "Main campus Google",
  };

  it("names the wait while auth hydrates", () => {
    expect(
      resolveReputationAccountNewSubmitButtonLabel({ ...ready, authLoading: true }),
    ).toBe(REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY);
  });

  it("names missing facility scope on the submit button", () => {
    expect(
      resolveReputationAccountNewSubmitButtonLabel({ ...ready, facilityReady: false }),
    ).toBe(REPUTATION_ACCOUNT_NEW_SELECT_FACILITY_SUBMIT_COPY);
  });

  it("names missing label on the submit button", () => {
    expect(resolveReputationAccountNewSubmitButtonLabel({ ...ready, label: "" })).toBe(
      REPUTATION_ACCOUNT_NEW_LABEL_REQUIRED_SUBMIT_COPY,
    );
  });
});
