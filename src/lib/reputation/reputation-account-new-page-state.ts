import {
  isExecutiveOrganizationGapError,
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import {
  REPUTATION_ACCOUNT_NEW_LABEL_REQUIRED_SUBMIT_COPY,
  REPUTATION_ACCOUNT_NEW_SELECT_FACILITY_SUBMIT_COPY,
  REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "./reputation-account-new-display-copy";

const LEGACY_SIGN_IN_REQUIRED_COPY = "Sign in required.";

export {
  resolveExecutiveOrganizationGapMessage as resolveReputationAccountNewOrganizationGapMessage,
};

export function isReputationAccountNewAuthGapError(message: string | null | undefined): boolean {
  if (!message) return false;
  return isExecutiveOrganizationGapError(message) || message === LEGACY_SIGN_IN_REQUIRED_COPY;
}

export function resolveReputationAccountNewFetchErrorBannerMessage(options: {
  authLoading: boolean;
  fetchError: string | null;
}): string | null {
  if (options.authLoading) return null;
  if (!options.fetchError) return null;
  if (isReputationAccountNewAuthGapError(options.fetchError)) return null;
  return options.fetchError;
}

export function isReputationAccountNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  userId: string | null;
  facilityReady: boolean;
  label: string;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.userId) return true;
  if (!options.facilityReady) return true;
  if (!options.label.trim()) return true;
  return false;
}

export function resolveReputationAccountNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  userId: string | null;
  facilityReady: boolean;
  label: string;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY;
  if (!options.organizationId || !options.userId) {
    return REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY;
  }
  if (!options.facilityReady) return REPUTATION_ACCOUNT_NEW_SELECT_FACILITY_SUBMIT_COPY;
  if (!options.label.trim()) return REPUTATION_ACCOUNT_NEW_LABEL_REQUIRED_SUBMIT_COPY;
  return "Save listing";
}
