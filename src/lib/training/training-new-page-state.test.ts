import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { TRAINING_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./training-new-display-copy";
import {
  isTrainingNewSubmitBlocked,
  resolveTrainingNewFetchErrorBannerMessage,
  resolveTrainingNewOrganizationGapMessage,
  resolveTrainingNewSubmitButtonLabel,
} from "./training-new-page-state";

describe("resolveTrainingNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveTrainingNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveTrainingNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("resolveTrainingNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveTrainingNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveTrainingNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table competency_demonstrations",
      }),
    ).toBe("permission denied for table competency_demonstrations");
  });
});

describe("isTrainingNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "org-anon-1",
    facilityReady: true,
    staffId: "staff-anon-1",
  };

  it("blocks while auth hydrates", () => {
    expect(isTrainingNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isTrainingNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("allows submit when org, facility, and staff are present", () => {
    expect(isTrainingNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveTrainingNewSubmitButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(resolveTrainingNewSubmitButtonLabel({ saving: false, authLoading: true })).toBe(
      TRAINING_NEW_WAITING_PROFILE_SUBMIT_COPY,
    );
  });
});
