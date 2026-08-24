/**
 * Quiet Operator copy for the admin watch center (`/admin/rounding/watches`).
 * Missing facility scope names the gap — never interpolate legacy "selected facility" copy.
 */

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "./observation-plan-display-copy";

export { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY };

export const WATCHES_BOARD_LOADING_COPY = "Loading watch center…";
export const WATCHES_BOARD_WATCH_TIMES_ET_CUE = "Watch times are Eastern (ET).";

export type WatchesBoardFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope — never fabricates a facility name. */
export function resolveWatchesBoardFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): WatchesBoardFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

/** Page subtitle — unscoped uses the shared select-facility gap, never "selected facility". */
export function formatWatchesBoardPageSubtitle(scope: WatchesBoardFacilityScope): string {
  if (scope.kind === "unscoped") return OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY;
  if (scope.kind === "named") {
    return `Review active watches, approve auto-triggered monitoring, and close the loop on resident-specific safety protocols at ${scope.name}.`;
  }
  return "Review active watches, approve auto-triggered monitoring, and close the loop on resident-specific safety protocols.";
}

/** Empty-state title when a facility is scoped but no watch instances match the filter. */
export function formatWatchesBoardNoWatchesEmptyTitle(scope: WatchesBoardFacilityScope): string {
  if (scope.kind === "named") return `No watches at ${scope.name}`;
  return "No watches posted";
}

const WATCHES_NEW_YORK_TZ = "America/New_York";

/** Watch instance or event timestamp — facility wall clock in Eastern (ET). */
export function formatWatchesBoardDateTime(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "—";

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "—";

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: WATCHES_NEW_YORK_TZ,
    }).format(date);
  } catch {
    return "—";
  }
}
