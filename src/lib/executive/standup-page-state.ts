import type { ExecutiveStandupLive } from "@/lib/executive/standup";

/** Quiet Operator named gap when auth resolved but the profile has no organization. */
export const EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY = "No organization on this profile";

export function hasExecutiveStandupOrgScopedPackData(live: ExecutiveStandupLive | null): boolean {
  return (live?.facilities?.length ?? 0) > 0;
}

/**
 * Organization gap copy when the session truly lacks an organization and the
 * standup pack has not loaded org-scoped rows. Suppressed while auth hydrates
 * or when live pack data already proves organization context.
 */
export function resolveExecutiveStandupOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedPackData: boolean;
}): string | null {
  if (options.authLoading) return null;
  if (options.organizationId) return null;
  if (options.hasOrgScopedPackData) return null;
  return EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY;
}

/** Red crash banner is reserved for fetch/action failures — not org gaps. */
export function resolveExecutiveStandupFetchErrorBannerMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  fetchError: string | null;
  hasOrgScopedPackData: boolean;
}): string | null {
  if (options.authLoading) return null;
  if (!options.fetchError) return null;
  if (
    !options.organizationId &&
    options.hasOrgScopedPackData &&
    options.fetchError === "Organization missing on profile."
  ) {
    return null;
  }
  return options.fetchError;
}
