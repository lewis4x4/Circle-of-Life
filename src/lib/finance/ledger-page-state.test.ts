import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveLedgerFetchErrorBannerMessage,
  resolveLedgerOrganizationGapMessage,
} from "./ledger-page-state";

describe("resolveLedgerOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveLedgerOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveLedgerOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveLedgerOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveLedgerFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveLedgerFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveLedgerFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table journal_entries",
      }),
    ).toBe("permission denied for table journal_entries");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveLedgerFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table journal_entries",
      }),
    ).toBeNull();
  });
});
