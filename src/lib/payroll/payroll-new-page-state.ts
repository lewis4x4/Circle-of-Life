import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import { PAYROLL_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./payroll-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolvePayrollNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolvePayrollNewFetchErrorBannerMessage,
};

export function isPayrollNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  userId: string | null | undefined;
  facilityReady: boolean;
  periodStart: string;
  periodEnd: string;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.userId) return true;
  if (!options.facilityReady) return true;
  if (!options.periodStart || !options.periodEnd) return true;
  return false;
}

export function resolvePayrollNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return PAYROLL_NEW_WAITING_PROFILE_SUBMIT_COPY;
  return "Create draft";
}
