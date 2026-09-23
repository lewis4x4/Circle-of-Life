/**
 * Facility scope copy shared by every Smart Rounding surface.
 *
 * This replaces `observation-plan-display-copy.ts` and
 * `rounding-facility-scope-copy.ts`, both of which were named for surfaces this
 * module no longer has: the per resident observation plan (spec 25A defect 7)
 * and the resident safety score board (section 7.1). What survives is the part
 * that was never about either of them, which is how a board names the building
 * it is scoped to without inventing a name it does not hold.
 */

/** Shown when a facility id is selected but its name has not resolved yet. */
export const ROUNDING_NO_FACILITY_NAME_COPY = "No facility name posted";

export type RoundingFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope. It never fabricates a name. */
export function resolveRoundingFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): RoundingFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

/** "at Building" when the name is known, and nothing at all when it is not. */
export function roundingScopeSuffix(scope: RoundingFacilityScope): string {
  return scope.kind === "named" ? ` at ${scope.name}` : "";
}
