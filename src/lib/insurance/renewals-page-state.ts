import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

export const INSURANCE_RENEWALS_LOADING_PROFILE_COPY = "Loading insurance profile…";
export const INSURANCE_RENEWALS_LOADING_LIST_COPY = "Loading renewals…";

/** Quiet Operator named gap when auth resolved but the profile has no organization. */
export function resolveInsuranceRenewalsOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedData: boolean;
}): string | null {
  return resolveExecutiveOrganizationGapMessage(options);
}

/** Red crash banner is reserved for fetch failures — not org gaps. */
export function resolveInsuranceRenewalsFetchErrorBannerMessage(options: {
  authLoading: boolean;
  fetchError: string | null;
}): string | null {
  return resolveExecutiveFetchErrorBannerMessage(options);
}
