import {
  isExecutiveOrganizationGapError,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import {
  TRANSPORT_REQUEST_DETAIL_MISSING_ORG_SUBMIT_COPY,
  TRANSPORT_REQUEST_DETAIL_SIGN_IN_TO_SAVE_COPY,
  TRANSPORT_REQUEST_DETAIL_WAITING_PROFILE_SUBMIT_COPY,
} from "./transport-request-detail-display-copy";

const LEGACY_SIGN_IN_ERROR_COPY = "Sign in required.";

export {
  resolveExecutiveOrganizationGapMessage as resolveTransportRequestDetailOrganizationGapMessage,
};

export function resolveTransportRequestDetailEffectiveOrganizationId(
  organizationId: string | null,
  rowOrganizationId: string | null | undefined,
): string | null {
  return organizationId ?? rowOrganizationId ?? null;
}

export function isTransportRequestDetailSignInGapError(message: string | null | undefined): boolean {
  if (!message) return false;
  return message === TRANSPORT_REQUEST_DETAIL_SIGN_IN_TO_SAVE_COPY || message === LEGACY_SIGN_IN_ERROR_COPY;
}

/** Red crash banner is reserved for fetch/save failures — not auth or org gaps. */
export function resolveTransportRequestDetailFetchErrorBannerMessage(options: {
  authLoading: boolean;
  fetchError: string | null;
}): string | null {
  if (options.authLoading) return null;
  if (!options.fetchError) return null;
  if (isExecutiveOrganizationGapError(options.fetchError)) return null;
  if (isTransportRequestDetailSignInGapError(options.fetchError)) return null;
  return options.fetchError;
}

export function resolveTransportRequestDetailSignInGapMessage(options: {
  authLoading: boolean;
  user: unknown;
}): string | null {
  if (options.authLoading) return null;
  if (options.user) return null;
  return TRANSPORT_REQUEST_DETAIL_SIGN_IN_TO_SAVE_COPY;
}

export function isTransportRequestDetailSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  user: unknown;
  effectiveOrganizationId: string | null;
  facilityReady: boolean;
  hasRow: boolean;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.user) return true;
  if (!options.effectiveOrganizationId) return true;
  if (!options.facilityReady) return true;
  if (!options.hasRow) return true;
  return false;
}

export function resolveTransportRequestDetailSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
  user: unknown;
  effectiveOrganizationId: string | null;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return TRANSPORT_REQUEST_DETAIL_WAITING_PROFILE_SUBMIT_COPY;
  if (!options.user) return TRANSPORT_REQUEST_DETAIL_SIGN_IN_TO_SAVE_COPY;
  if (!options.effectiveOrganizationId) return TRANSPORT_REQUEST_DETAIL_MISSING_ORG_SUBMIT_COPY;
  return "Save";
}
