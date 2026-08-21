import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";

export {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY as INSIGHTS_BOARD_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage as resolveInsightsBoardFetchErrorBannerMessage,
};

export type InsightsBoardLoadState = "idle" | "loading" | "ready" | "error";

export type InsightsBoardState =
  | "no_facility"
  | "auth_loading"
  | "no_organization"
  | "loading"
  | "error"
  | "empty"
  | "empty_filtered"
  | "populated";

export function deriveInsightsBoardState(args: {
  authLoading: boolean;
  organizationId: string | null;
  loadState: InsightsBoardLoadState;
  hasFacility: boolean;
  visibleRowCount: number;
  filterApplied: boolean;
}): InsightsBoardState {
  if (!args.hasFacility) return "no_facility";
  if (args.authLoading) return "auth_loading";
  if (!args.organizationId) return "no_organization";
  if (args.loadState === "loading" || args.loadState === "idle") return "loading";
  if (args.loadState === "error") return "error";
  if (args.visibleRowCount === 0) {
    return args.filterApplied ? "empty_filtered" : "empty";
  }
  return "populated";
}

export function resolveInsightsBoardOrganizationGapMessage(options: {
  authLoading: boolean;
  organizationId: string | null;
  hasOrgScopedData: boolean;
}): string | null {
  return resolveExecutiveOrganizationGapMessage(options);
}

export function formatInsightsBoardPageSubtitle(
  facilityScopeLabel: string,
  options: { dataReady: boolean; insightCycleStarted: boolean },
): string {
  if (options.dataReady && !options.insightCycleStarted) {
    return `No insight cycle has started at ${facilityScopeLabel} yet. Patterns surface after rounding observations and analysis runs.`;
  }
  return `Clinical pattern detection, anomaly review, and early warnings across rounding activity at ${facilityScopeLabel}.`;
}
