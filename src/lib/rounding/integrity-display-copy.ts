/**
 * Quiet Operator copy for the admin documentation integrity board
 * (`/admin/rounding/integrity`). Missing facility scope names the gap —
 * never interpolate legacy "selected facility" copy.
 */

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "@/lib/rounding/observation-plan-display-copy";

export { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY as INTEGRITY_SELECT_FACILITY_FIRST_COPY };

export const INTEGRITY_NO_FACILITY_NAME_COPY = "No facility name posted";

export type IntegrityFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

/** Page header and empty-state facility scope — never fabricates a facility name. */
export function resolveIntegrityFacilityScope(
  selectedFacilityId: string | null,
  selectedFacilityName: string | null | undefined,
): IntegrityFacilityScope {
  if (!selectedFacilityId) return { kind: "unscoped" };
  const trimmed = selectedFacilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

const INTEGRITY_SUBTITLE_BASE =
  "Late entries, retroactive documentation, and audit-evidence flags before they become survey findings";

/** Page header subtitle — never interpolates "selected facility". */
export function formatIntegrityPageSubtitle(scope: IntegrityFacilityScope): string {
  if (scope.kind === "unscoped") {
    return `${INTEGRITY_SUBTITLE_BASE} are per facility. ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  if (scope.kind === "missing_name") {
    return `${INTEGRITY_SUBTITLE_BASE}. ${INTEGRITY_NO_FACILITY_NAME_COPY}.`;
  }
  return `${INTEGRITY_SUBTITLE_BASE} at ${scope.name}.`;
}

/** Empty-state title when a facility is scoped but no integrity flags exist. */
export function formatIntegrityNoFlagsEmptyTitle(scope: IntegrityFacilityScope): string {
  if (scope.kind === "named") return `No integrity flags at ${scope.name}`;
  if (scope.kind === "unscoped") {
    return `No integrity flags posted. ${OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY}`;
  }
  return "No integrity flags posted";
}
