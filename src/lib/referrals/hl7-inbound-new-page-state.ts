import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import { HL7_INBOUND_NEW_WAITING_PROFILE_SUBMIT_COPY } from "./hl7-inbound-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveHl7InboundNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveHl7InboundNewFetchErrorBannerMessage,
};

export function isHl7InboundNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  organizationId: string | null;
  userId: string | null | undefined;
  facilityReady: boolean;
  rawMessage: string;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.organizationId) return true;
  if (!options.userId) return true;
  if (!options.facilityReady) return true;
  if (!options.rawMessage.trim()) return true;
  return false;
}

export function resolveHl7InboundNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return HL7_INBOUND_NEW_WAITING_PROFILE_SUBMIT_COPY;
  return "Add to Inbox";
}
