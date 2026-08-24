import {
  isExecutiveOrganizationGapError,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import {
  REPUTATION_REPLY_NEW_REPLY_REQUIRED_SUBMIT_COPY,
  REPUTATION_REPLY_NEW_SELECT_FACILITY_SUBMIT_COPY,
  REPUTATION_REPLY_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "./reputation-reply-new-display-copy";

const LEGACY_SIGN_IN_REQUIRED_COPY = "Sign in required.";

export {
  resolveExecutiveOrganizationGapMessage as resolveReputationReplyNewOrganizationGapMessage,
};

export function isReputationReplyNewAuthGapError(message: string | null | undefined): boolean {
  if (!message) return false;
  return isExecutiveOrganizationGapError(message) || message === LEGACY_SIGN_IN_REQUIRED_COPY;
}

export function resolveReputationReplyNewFetchErrorBannerMessage(options: {
  authLoading: boolean;
  fetchError: string | null;
}): string | null {
  if (options.authLoading) return null;
  if (!options.fetchError) return null;
  if (isReputationReplyNewAuthGapError(options.fetchError)) return null;
  return options.fetchError;
}

export function isReputationReplyNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  userId: string | null;
  facilityReady: boolean;
  accountId: string;
  replyBody: string;
  accountsLoading: boolean;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.userId) return true;
  if (!options.facilityReady) return true;
  if (options.accountsLoading) return true;
  if (!options.accountId) return true;
  if (!options.replyBody.trim()) return true;
  return false;
}

export function resolveReputationReplyNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  userId: string | null;
  facilityReady: boolean;
  accountId: string;
  replyBody: string;
  accountsLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return REPUTATION_REPLY_NEW_WAITING_PROFILE_SUBMIT_COPY;
  if (!options.organizationId || !options.userId) {
    return REPUTATION_REPLY_NEW_WAITING_PROFILE_SUBMIT_COPY;
  }
  if (!options.facilityReady) return REPUTATION_REPLY_NEW_SELECT_FACILITY_SUBMIT_COPY;
  if (options.accountsLoading) return "Loading listings…";
  if (!options.accountId) return "Select a listing";
  if (!options.replyBody.trim()) return REPUTATION_REPLY_NEW_REPLY_REQUIRED_SUBMIT_COPY;
  return "Save reply";
}
