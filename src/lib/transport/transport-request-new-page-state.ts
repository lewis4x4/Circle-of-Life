import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import { TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./transport-request-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveTransportRequestNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveTransportRequestNewFetchErrorBannerMessage,
};

export function isTransportRequestNewSubmitBlocked(options: {
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

export function resolveTransportRequestNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY;
  return "Create request";
}
