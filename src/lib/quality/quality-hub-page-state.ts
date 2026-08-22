import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

export {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY as QUALITY_HUB_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage as resolveQualityHubFetchErrorBannerMessage,
};

export const QUALITY_HUB_LOADING_MESSAGE = "Loading quality hub…";

/** Rose retry banner — org gap is surfaced separately. */
export const QUALITY_HUB_UNEXPECTED_FETCH_ERROR_COPY =
  "Could not load quality data. Try again, or contact support if this persists.";

export type QualityHubLoadState = "idle" | "loading" | "ready" | "error";

export type QualityHubState =
  | "no_facility"
  | "auth_loading"
  | "no_organization"
  | "loading"
  | "error"
  | "populated";

export function deriveQualityHubState(args: {
  authLoading: boolean;
  organizationId: string | null;
  loadState: QualityHubLoadState;
  hasFacility: boolean;
}): QualityHubState {
  if (!args.hasFacility) return "no_facility";
  if (args.authLoading) return "auth_loading";
  if (!args.organizationId) return "no_organization";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  return "populated";
}

export function resolveQualityHubOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedData: boolean;
}): string | null {
  return resolveExecutiveOrganizationGapMessage(options);
}

export function resolveQualityHubQueryErrorMessage(
  queryError: unknown,
): string | null {
  if (!queryError) return null;
  if (queryError instanceof Error && queryError.message.trim()) {
    return queryError.message;
  }
  return QUALITY_HUB_UNEXPECTED_FETCH_ERROR_COPY;
}
