import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import {
  resolveJournalEntriesFetchErrorBannerMessage,
  resolveJournalEntriesOrganizationGapMessage,
} from "./journal-entries-page-state";

describe("resolveJournalEntriesOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveJournalEntriesOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveJournalEntriesOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });

  it("suppresses the gap when org-scoped rows are already on screen", () => {
    expect(
      resolveJournalEntriesOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: true,
      }),
    ).toBeNull();
  });
});

describe("resolveJournalEntriesFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveJournalEntriesFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real fetch failures", () => {
    expect(
      resolveJournalEntriesFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "permission denied for table journal_entries",
      }),
    ).toBe("permission denied for table journal_entries");
  });

  it("suppresses fetch errors while auth is hydrating", () => {
    expect(
      resolveJournalEntriesFetchErrorBannerMessage({
        authLoading: true,
        fetchError: "permission denied for table journal_entries",
      }),
    ).toBeNull();
  });
});
