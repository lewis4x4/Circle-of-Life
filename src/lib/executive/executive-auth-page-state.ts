/** Quiet Operator named gap when auth resolved but the profile has no organization. */
export const EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY = "No organization on this profile";

const EXECUTIVE_LEGACY_ORGANIZATION_ERROR_COPY = "Organization missing on profile.";

export function isExecutiveOrganizationGapError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message === EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY ||
    message === EXECUTIVE_LEGACY_ORGANIZATION_ERROR_COPY
  );
}

/**
 * Organization gap copy when the session truly lacks an organization and no
 * org-scoped data is already on screen. Suppressed while auth hydrates or when
 * loaded rows already prove organization context.
 */
export function resolveExecutiveOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedData: boolean;
}): string | null {
  if (options.authLoading) return null;
  if (options.organizationId) return null;
  if (options.hasOrgScopedData) return null;
  return EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY;
}

/** Red crash banner is reserved for fetch/action failures — not org gaps. */
export function resolveExecutiveFetchErrorBannerMessage(options: {
  authLoading: boolean;
  fetchError: string | null;
}): string | null {
  if (options.authLoading) return null;
  if (!options.fetchError) return null;
  if (isExecutiveOrganizationGapError(options.fetchError)) return null;
  return options.fetchError;
}
