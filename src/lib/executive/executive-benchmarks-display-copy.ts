/**
 * Quiet Operator copy for executive benchmark cohort facility lists.
 * Empty selection names the gap — never a silent em dash.
 */

export const EXECUTIVE_NO_FACILITIES_POSTED_COPY = "No facilities posted";

/** Cross-operator card — names the real gap. Do not call the page a stub. */
export const EXECUTIVE_CROSS_OPERATOR_GAP_COPY =
  "Disabled by default. Opt-in records organization intent and keeps external peer comparisons blocked until a governed data-sharing program exists.";

/** Stored on the opt-in row so the request log does not call this surface a stub. */
export const EXECUTIVE_CROSS_OPERATOR_OPT_IN_NOTE =
  "Opt-in request recorded. External peer data remains disabled until a governed sharing program exists.";

export type ExecutiveBenchmarkFacilitiesDisplayInput = {
  facilityIds: string[] | null | undefined;
  facNameById: Record<string, string>;
};

/** Cohort facilities column — empty/missing ids name the gap; posted ids show labels or count fallback. */
export function formatExecutiveBenchmarkFacilitiesDisplay({
  facilityIds,
  facNameById,
}: ExecutiveBenchmarkFacilitiesDisplayInput): string {
  const ids = facilityIds ?? [];
  if (ids.length === 0) return EXECUTIVE_NO_FACILITIES_POSTED_COPY;

  const labels = ids.map((id) => facNameById[id] ?? id.slice(0, 8)).join(", ");
  return labels || `${ids.length} selected`;
}
