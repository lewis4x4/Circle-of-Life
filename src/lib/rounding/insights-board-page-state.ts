import {
  EXECUTIVE_NO_ORGANIZATION_ON_PROFILE_COPY,
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import {
  SAFETY_BOARD_NO_FACILITY_SCOPE_COPY,
  type SafetyBoardFacilityScope,
} from "@/lib/rounding/safety-board-display-copy";

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

const INSIGHTS_BOARD_UNSCOPED_SUBTITLE_COPY =
  "Insights are per facility. Use the top-bar facility filter to select a site.";

const INSIGHTS_BOARD_ACTIVITY_SUBTITLE_PREFIX =
  "Clinical pattern detection, anomaly review, and early warnings across rounding activity";

const INSIGHTS_BOARD_UNSTARTED_CYCLE_SUFFIX =
  "Patterns surface after rounding observations and analysis runs.";

export function formatInsightsBoardPageSubtitle(
  scope: SafetyBoardFacilityScope,
  options: { dataReady: boolean; insightCycleStarted: boolean },
): string {
  if (options.dataReady && !options.insightCycleStarted) {
    if (scope.kind === "named") {
      return `No insight cycle has started at ${scope.name} yet. ${INSIGHTS_BOARD_UNSTARTED_CYCLE_SUFFIX}`;
    }
    if (scope.kind === "unscoped") return INSIGHTS_BOARD_UNSCOPED_SUBTITLE_COPY;
    return `No insight cycle has started yet. ${INSIGHTS_BOARD_UNSTARTED_CYCLE_SUFFIX} ${SAFETY_BOARD_NO_FACILITY_SCOPE_COPY}.`;
  }

  if (scope.kind === "named") {
    return `${INSIGHTS_BOARD_ACTIVITY_SUBTITLE_PREFIX} at ${scope.name}.`;
  }
  if (scope.kind === "unscoped") return INSIGHTS_BOARD_UNSCOPED_SUBTITLE_COPY;
  return `${INSIGHTS_BOARD_ACTIVITY_SUBTITLE_PREFIX}. ${SAFETY_BOARD_NO_FACILITY_SCOPE_COPY}.`;
}
