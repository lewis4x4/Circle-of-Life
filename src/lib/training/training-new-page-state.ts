import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import { TRAINING_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./training-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveTrainingNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveTrainingNewFetchErrorBannerMessage,
};

export function isTrainingNewSubmitBlocked(options: {
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

export function resolveTrainingNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return TRAINING_NEW_WAITING_PROFILE_SUBMIT_COPY;
  return "Save draft";
}
