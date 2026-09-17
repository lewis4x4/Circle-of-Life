/**
 * Facility scope copy shared by the Smart Rounding boards.
 *
 * Extracted from `safety-board-display-copy.ts`, which went with the resident
 * safety score surface it was written for (spec 25A section 7.1). Everything in
 * that file about a score, a component metric or a score trend went with it;
 * what survives is the part that was never about scores at all, which is how a
 * board names the building it is scoped to without fabricating a name it does
 * not have.
 *
 * The old symbol names are preserved so the boards that still read this copy
 * keep reading the same strings.
 */

/** Stand-alone gap when a facility id is selected but the name has not resolved. */
export const SAFETY_BOARD_NO_FACILITY_SCOPE_COPY = "No facility name posted";

export type SafetyBoardFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope. It never fabricates a facility name. */
export function resolveSafetyBoardFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): SafetyBoardFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

/** Empty-state title when a facility is scoped but no insights exist yet. */
export function formatInsightsBoardNoInsightsEmptyTitle(scope: SafetyBoardFacilityScope): string {
  if (scope.kind === "named") return `No rounding activity insights at ${scope.name}`;
  return "No rounding activity insights posted";
}
