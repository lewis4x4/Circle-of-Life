/**
 * Quiet Operator copy for Form 1823 alignment (`/admin/care-plans/form-1823-alignment`).
 * Title scope names the facility when posted — never says "Selected facility".
 */

export const FORM_1823_ALIGNMENT_ALL_FACILITIES_COPY = "All facilities";
export const FORM_1823_ALIGNMENT_NO_FACILITY_NAME_COPY = "No facility name posted";

/** Header facility scope label — org-wide, named, or explicit missing-name gap. */
export function formatForm1823AlignmentFacilityTitle(
  selectedFacilityId: string | null | undefined,
  facilityName: string | null | undefined,
): string {
  if (!selectedFacilityId) return FORM_1823_ALIGNMENT_ALL_FACILITIES_COPY;
  const trimmed = facilityName?.trim();
  if (trimmed) return trimmed;
  return FORM_1823_ALIGNMENT_NO_FACILITY_NAME_COPY;
}

/** Empty-roster body — names the facility when posted; never "the selected facility". */
export function formatForm1823AlignmentEmptyRosterCopy(
  facilityName: string | null | undefined,
): string {
  const trimmed = facilityName?.trim();
  const where = trimmed ? trimmed : "this facility";
  return `Residents with status active, hospital hold, or leave of absence appear here once they exist in ${where}.`;
}
