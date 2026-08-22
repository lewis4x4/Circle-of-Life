import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import { AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY } from "./audit-export-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveAuditExportOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveAuditExportFetchErrorBannerMessage,
};

export function isAuditExportActionBlocked(options: {
  exporting: boolean;
  authLoading: boolean;
  organizationId: string | null;
  roleOk: boolean;
}): boolean {
  if (options.exporting) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.roleOk) return true;
  return false;
}

export function resolveAuditExportButtonLabel(options: {
  exporting: boolean;
  authLoading: boolean;
}): string {
  if (options.exporting) return "Exporting…";
  if (options.authLoading) return AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY;
  return "Download CSV";
}
