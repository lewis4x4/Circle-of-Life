import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import { SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY } from "@/lib/rounding/safety-board-display-copy";

export {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY as SAFETY_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage as resolveSafetyBoardFetchErrorBannerMessage,
};

export type SafetyBoardLoadState = "idle" | "loading" | "ready" | "error";

export type SafetyBoardState =
  | "no_facility"
  | "auth_loading"
  | "no_organization"
  | "loading"
  | "error"
  | "empty"
  | "populated";

export function deriveSafetyBoardState(args: {
  authLoading: boolean;
  organizationId: string | null;
  loadState: SafetyBoardLoadState;
  hasFacility: boolean;
  rowCount: number;
}): SafetyBoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.authLoading) return "auth_loading";
  if (!args.organizationId) return "no_organization";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.rowCount === 0) return "empty";
  return "populated";
}

export function resolveSafetyBoardOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedData: boolean;
}): string | null {
  return resolveExecutiveOrganizationGapMessage(options);
}

export function formatSafetyBoardPageSubtitle(facilityScopeLabel: string): string {
  return `Composite safety scores updated daily from observation compliance, incident recency, and medication adherence at ${facilityScopeLabel}.`;
}

export function formatSafetyBoardUnexpectedFetchError(): string {
  return SAFETY_BOARD_UNEXPECTED_FETCH_ERROR_COPY;
}
