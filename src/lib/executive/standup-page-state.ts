import type { ExecutiveStandupLive, StandupSnapshotDetail } from "@/lib/executive/standup";
import { resolveExecutiveOrganizationGapMessage } from "./executive-auth-page-state";

export {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY as EXECUTIVE_STANDUP_NO_ORGANIZATION_ON_PROFILE_COPY,
  isExecutiveOrganizationGapError as isExecutiveStandupOrganizationGapError,
  resolveExecutiveFetchErrorBannerMessage as resolveExecutiveStandupFetchErrorBannerMessage,
} from "./executive-auth-page-state";

export const EXECUTIVE_STANDUP_WEEK_LOADING_MESSAGE = "Loading standup…";
export const EXECUTIVE_STANDUP_BOARD_LOADING_MESSAGE = "Loading standup board…";

export function hasExecutiveStandupOrgScopedPackData(live: ExecutiveStandupLive | null): boolean {
  return (live?.facilities?.length ?? 0) > 0;
}

export function hasExecutiveStandupOrgScopedDetailData(detail: StandupSnapshotDetail | null): boolean {
  return detail != null;
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
