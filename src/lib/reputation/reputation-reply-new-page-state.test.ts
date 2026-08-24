import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { resolveReputationReplyNewOrganizationGapMessage } from "./reputation-reply-new-page-state";

describe("resolveReputationReplyNewOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveReputationReplyNewOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveReputationReplyNewOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("never returns the legacy organization crash string", () => {
    const gapMessage = resolveReputationReplyNewOrganizationGapMessage({
      authLoading: false,
      organizationId: null,
      hasOrgScopedData: false,
    });
    expect(gapMessage).not.toBe("Organization missing on profile.");
    expect(gapMessage).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});
