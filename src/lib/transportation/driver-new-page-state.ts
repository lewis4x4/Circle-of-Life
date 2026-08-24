import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import { DRIVER_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./driver-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveDriverNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveDriverNewFetchErrorBannerMessage,
};

export function isDriverNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  facilityReady: boolean;
  staffId: string;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.facilityReady) return true;
  if (!options.staffId) return true;
  return false;
}

export function resolveDriverNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return DRIVER_NEW_WAITING_PROFILE_SUBMIT_COPY;
  return "Save credential";
}
