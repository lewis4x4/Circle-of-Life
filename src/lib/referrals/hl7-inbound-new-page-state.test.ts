import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { HL7_INBOUND_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./hl7-inbound-new-display-copy";
import {
  isHl7InboundNewSubmitBlocked,
  resolveHl7InboundNewFetchErrorBannerMessage,
  resolveHl7InboundNewOrganizationGapMessage,
  resolveHl7InboundNewSubmitButtonLabel,
} from "./hl7-inbound-new-page-state";

describe("resolveHl7InboundNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveHl7InboundNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveHl7InboundNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("never returns the legacy organization crash string", () => {
    const message = resolveHl7InboundNewOrganizationGapMessage({
      authLoading: false,
      organizationId: null,
      hasOrgScopedData: false,
    });
    expect(message).not.toBe("Organization missing on profile.");
  });
});

describe("resolveHl7InboundNewFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveHl7InboundNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real insert failures", () => {
    expect(
      resolveHl7InboundNewFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table referral_hl7_inbound",
      }),
    ).toBe("permission denied for table referral_hl7_inbound");
  });
});

describe("isHl7InboundNewSubmitBlocked", () => {
  const ready = {
    saving: false,
    authLoading: false,
    organizationId: "00000000-0000-4000-8000-00000000org1",
    userId: "00000000-0000-4000-8000-00000000usr1",
    facilityReady: true,
    rawMessage: "sample inbound referral payload",
  };

  it("blocks while auth hydrates", () => {
    expect(isHl7InboundNewSubmitBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isHl7InboundNewSubmitBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("blocks when user is missing after auth", () => {
    expect(isHl7InboundNewSubmitBlocked({ ...ready, userId: null })).toBe(true);
  });

  it("allows submit when org, user, facility, and payload are present", () => {
    expect(isHl7InboundNewSubmitBlocked(ready)).toBe(false);
  });
});

describe("resolveHl7InboundNewSubmitButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(resolveHl7InboundNewSubmitButtonLabel({ saving: false, authLoading: true })).toBe(
      HL7_INBOUND_NEW_WAITING_PROFILE_SUBMIT_COPY,
    );
  });
});
