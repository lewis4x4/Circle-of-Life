import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import {
  DIETARY_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "./dietary-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveDietaryNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveDietaryNewFetchErrorBannerMessage,
};

export function isDietaryNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  facilityReady: boolean;
  residentId: string;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.facilityReady) return true;
  if (!options.residentId) return true;
  return false;
}

export function resolveDietaryNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return DIETARY_NEW_WAITING_PROFILE_SUBMIT_COPY;
  return "Save draft";
}
