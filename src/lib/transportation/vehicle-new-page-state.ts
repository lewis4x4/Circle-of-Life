import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

import {
  VEHICLE_NEW_ENTER_NAME_SUBMIT_COPY,
  VEHICLE_NEW_NO_ORGANIZATION_SUBMIT_COPY,
  VEHICLE_NEW_SELECT_FACILITY_SUBMIT_COPY,
  VEHICLE_NEW_SIGN_IN_SUBMIT_COPY,
  VEHICLE_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "./vehicle-new-display-copy";

export {
  resolveExecutiveOrganizationGapMessage as resolveVehicleNewOrganizationGapMessage,
  resolveExecutiveFetchErrorBannerMessage as resolveVehicleNewFetchErrorBannerMessage,
};

export function isVehicleNewSubmitBlocked(options: {
  saving: boolean;
  authLoading: boolean;
  user: { id: string } | null;
  organizationId: string | null;
  facilityReady: boolean;
  name: string;
}): boolean {
  if (options.saving) return true;
  if (options.authLoading) return true;
  if (!options.user) return true;
  if (!options.organizationId) return true;
  if (!options.facilityReady) return true;
  if (!options.name.trim()) return true;
  return false;
}

export function resolveVehicleNewSubmitButtonLabel(options: {
  saving: boolean;
  authLoading: boolean;
  user: { id: string } | null;
  organizationId: string | null;
  facilityReady: boolean;
  name: string;
}): string {
  if (options.saving) return "Saving…";
  if (options.authLoading) return VEHICLE_NEW_WAITING_PROFILE_SUBMIT_COPY;
  if (!options.user) return VEHICLE_NEW_SIGN_IN_SUBMIT_COPY;
  if (!options.organizationId) return VEHICLE_NEW_NO_ORGANIZATION_SUBMIT_COPY;
  if (!options.facilityReady) return VEHICLE_NEW_SELECT_FACILITY_SUBMIT_COPY;
  if (!options.name.trim()) return VEHICLE_NEW_ENTER_NAME_SUBMIT_COPY;
  return "Save vehicle";
}
