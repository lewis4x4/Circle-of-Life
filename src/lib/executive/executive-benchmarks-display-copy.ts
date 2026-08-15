/**
 * Quiet Operator copy for executive benchmark cohort facility lists.
 * Empty selection names the gap — never a silent em dash.
 */

export const EXECUTIVE_NO_FACILITIES_POSTED_COPY = "No facilities posted";

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
