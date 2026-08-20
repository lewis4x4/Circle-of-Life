import type { ExecutiveStandupLive } from "@/lib/executive/standup";
import { resolveExecutiveOrganizationGapMessage } from "./executive-auth-page-state";

export {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY as EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY,
  isExecutiveOrganizationGapError as isExecutiveStandupOrganizationGapError,
  resolveExecutiveFetchErrorBannerMessage as resolveExecutiveStandupFetchErrorBannerMessage,
} from "./executive-auth-page-state";

export function hasExecutiveStandupOrgScopedPackData(live: ExecutiveStandupLive | null): boolean {
  return (live?.facilities?.length ?? 0) > 0;
}

export function resolveExecutiveStandupOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedPackData: boolean;
}): string | null {
  return resolveExecutiveOrganizationGapMessage({
    authLoading: options.authLoading,
    organizationId: options.organizationId,
    hasOrgScopedData: options.hasOrgScopedPackData,
  });
}
