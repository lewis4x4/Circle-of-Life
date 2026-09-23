/**
 * Quiet Operator copy for the Medicaid & Benefits queue (`/admin/benefits`).
 * Scope subtitles name the facility when posted — never say "selected facility".
 */

export function formatBenefitsQueueScopeSubtitle(
  selectedFacilityId: string | null | undefined,
  facilityName: string | null | undefined,
): string {
  if (!selectedFacilityId) {
    return "Showing facilities you are authorized to access.";
  }
  const trimmed = facilityName?.trim();
  if (trimmed) return `Showing ${trimmed}.`;
  return "Showing this facility.";
}
