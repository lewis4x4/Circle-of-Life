/**
 * Quiet Operator copy for the facility detail building tab.
 * Missing construction facts name real gaps — never fabricate bed counts or square footage.
 */

export const BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY = "No licensed-bed count posted";
export const BUILDING_TAB_NO_CEMP_STATUS_COPY = "No CEMP status posted";

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
