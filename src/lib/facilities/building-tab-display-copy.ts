/**
 * Quiet Operator copy for the facility detail building tab.
 * Missing construction facts name real gaps — never fabricate bed counts or square footage.
 */

export const BUILDING_TAB_HELPER =
  "Named “No … posted” rows are not captured yet — not silent blanks. Editable fields above save to the building profile when you post them.";

export const BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY = "No licensed-bed count posted";
export const BUILDING_TAB_NO_RESIDENT_ROOM_COUNT_COPY = "No resident-room count posted";
export const BUILDING_TAB_NO_COMMON_AREA_SQFT_COPY = "No common-area square footage posted";
export const BUILDING_TAB_NO_CEMP_STATUS_COPY = "No CEMP status posted";
export const BUILDING_TAB_NO_COUNTY_OEM_STATUS_HELPER_COPY = "County OEM filing status is not posted yet";

export const BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY = "No sprinkler coverage posted";
export const BUILDING_TAB_NO_SPRINKLER_SYSTEM_TYPE_COPY = "No sprinkler system type posted";
export const BUILDING_TAB_NO_SPRINKLER_INSPECTION_COPY = "No sprinkler inspection posted";
export const BUILDING_TAB_NO_NEXT_SPRINKLER_INSPECTION_COPY = "No next sprinkler inspection posted";

export const BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY = "No generator manufacturer posted";
export const BUILDING_TAB_NO_GENERATOR_TANK_RUNTIME_COPY = "No generator tank runtime posted";
export const BUILDING_TAB_NO_GENERATOR_CIRCUITS_COPY = "No generator circuits posted";
export const BUILDING_TAB_NO_GENERATOR_PM_TECHNICIAN_COPY = "No generator PM technician posted";

export const BUILDING_TAB_NO_SECURE_UNIT_COPY = "No secure unit posted";
export const BUILDING_TAB_NO_ELOPEMENT_DRILL_COPY = "No elopement drill posted";

export const BUILDING_TAB_NO_STORM_HARDENING_COPY = "No storm hardening posted";

export const BUILDING_TAB_NO_96_HOUR_READINESS_COPY =
  "AHCA Rule 59A-36.025 96-hour readiness: not computed on this screen yet.";

export const BUILDING_TAB_SPRINKLER_DETAIL_FOOTNOTE_COPY =
  "Additional sprinkler fields are not posted yet. Suppression type above remains the source on file.";

export const BUILDING_TAB_NO_SECTION_AUDIT_TRAIL_COPY = "No per-section audit trail posted yet.";

export const BUILDING_TAB_AGGREGATE_AUDIT_FOOTNOTE_COPY =
  "Building profile record (saved as one aggregate until per-section audit is posted).";

/** Uncaptured construction metrics on the building tab — each must name a gap, never an em dash. */
export const BUILDING_TAB_CONSTRUCTION_GAP_COPIES = [
  BUILDING_TAB_NO_RESIDENT_ROOM_COUNT_COPY,
  BUILDING_TAB_NO_COMMON_AREA_SQFT_COPY,
] as const;

/** Uncaptured scaffold rows on the building tab — each must name a gap, never an em dash. */
export const BUILDING_TAB_SCAFFOLD_GAP_COPIES = [
  BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY,
  BUILDING_TAB_NO_SPRINKLER_SYSTEM_TYPE_COPY,
  BUILDING_TAB_NO_SPRINKLER_INSPECTION_COPY,
  BUILDING_TAB_NO_NEXT_SPRINKLER_INSPECTION_COPY,
  BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY,
  BUILDING_TAB_NO_GENERATOR_TANK_RUNTIME_COPY,
  BUILDING_TAB_NO_GENERATOR_CIRCUITS_COPY,
  BUILDING_TAB_NO_GENERATOR_PM_TECHNICIAN_COPY,
  BUILDING_TAB_NO_SECURE_UNIT_COPY,
  BUILDING_TAB_NO_ELOPEMENT_DRILL_COPY,
  BUILDING_TAB_NO_CEMP_STATUS_COPY,
  BUILDING_TAB_NO_STORM_HARDENING_COPY,
] as const;

/** Scaffold-row value when unset; real zero stays numeric. Posted strings trim whitespace and reject lone em dashes. */
export function formatBuildingTabScaffoldValue(
  posted: string | number | null | undefined,
  gapCopy: string,
): string {
  if (posted == null || posted === "") return gapCopy;
  if (typeof posted === "number") {
    if (!Number.isFinite(posted)) return gapCopy;
    return String(posted);
  }
  const trimmed = posted.trim();
  if (!trimmed || trimmed === "—") return gapCopy;
  return trimmed;
}

/** Licensed-bed count on the building tab when unset; real zero stays numeric. */
export function formatBuildingTabLicensedBedCount(
  totalLicensedBeds: number | null | undefined,
): string {
  if (totalLicensedBeds == null) return BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY;
  if (typeof totalLicensedBeds !== "number" || !Number.isFinite(totalLicensedBeds)) {
    return BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY;
  }
  return String(totalLicensedBeds);
}

/** Whether the licensed-bed cell should use muted missing-data styling. */
export function buildingTabLicensedBedCountIsMissing(
  totalLicensedBeds: number | null | undefined,
): boolean {
  return formatBuildingTabLicensedBedCount(totalLicensedBeds) === BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY;
}
