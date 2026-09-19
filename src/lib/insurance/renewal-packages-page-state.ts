import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

export const INSURANCE_RENEWAL_PACKAGES_LOADING_PROFILE_COPY = "Loading insurance profile…";

/** Quiet Operator named gap when auth resolved but the profile has no organization. */
export function resolveInsuranceRenewalPackagesOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedData: boolean;
}): string | null {
  return resolveExecutiveOrganizationGapMessage(options);
}

/**
 * Retryable failure banner — fetch and mutation failures only. An organization
 * gap is not retryable, so it never reaches this lane.
 */
export function resolveInsuranceRenewalPackagesFetchErrorBannerMessage(options: {
  authLoading: boolean;
  fetchError: string | null;
}): string | null {
  return resolveExecutiveFetchErrorBannerMessage(options);
}
