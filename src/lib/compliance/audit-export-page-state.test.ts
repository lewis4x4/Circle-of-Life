import { describe, expect, it } from "vitest";

import { EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY } from "@/lib/executive/executive-auth-page-state";

import { AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY } from "./audit-export-display-copy";
import {
  isAuditExportActionBlocked,
  resolveAuditExportButtonLabel,
  resolveAuditExportFetchErrorBannerMessage,
  resolveAuditExportOrganizationGapMessage,
} from "./audit-export-page-state";

describe("resolveAuditExportOrganizationGapMessage", () => {
  it("returns null while auth is hydrating", () => {
    expect(
      resolveAuditExportOrganizationGapMessage({
        authLoading: true,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBeNull();
  });

  it("names the gap when auth resolved without an organization", () => {
    expect(
      resolveAuditExportOrganizationGapMessage({
        authLoading: false,
        organizationId: null,
        hasOrgScopedData: false,
      }),
    ).toBe(EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY);
  });
});

describe("resolveAuditExportFetchErrorBannerMessage", () => {
  it("suppresses legacy organization crash strings", () => {
    expect(
      resolveAuditExportFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Organization missing on profile.",
      }),
    ).toBeNull();
  });

  it("surfaces real export failures", () => {
    expect(
      resolveAuditExportFetchErrorBannerMessage({
        authLoading: false,
        fetchError: "Could not create export job.",
      }),
    ).toBe("Could not create export job.");
  });
});

describe("isAuditExportActionBlocked", () => {
  const ready = {
    exporting: false,
    authLoading: false,
    organizationId: "org-anon-1",
    roleOk: true,
  };

  it("blocks while auth hydrates", () => {
    expect(isAuditExportActionBlocked({ ...ready, authLoading: true })).toBe(true);
  });

  it("blocks when organization is missing after auth", () => {
    expect(isAuditExportActionBlocked({ ...ready, organizationId: null })).toBe(true);
  });

  it("blocks when role cannot export", () => {
    expect(isAuditExportActionBlocked({ ...ready, roleOk: false })).toBe(true);
  });

  it("allows export when org and role are present", () => {
    expect(isAuditExportActionBlocked(ready)).toBe(false);
  });
});

describe("resolveAuditExportButtonLabel", () => {
  it("names the wait while auth hydrates", () => {
    expect(resolveAuditExportButtonLabel({ exporting: false, authLoading: true })).toBe(
      AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY,
    );
  });
});
