/**
 * Quiet Operator copy for the admin incident detail page (`/admin/incidents/[id]`).
 * Missing injury fields name real gaps — never fabricate clinical text or resident names.
 */

export const INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY = "No injury description posted";
export const INCIDENT_DETAIL_NO_BODY_LOCATION_COPY = "No body location posted";

/** Injury description on the detail injury section when unset or blank. */
export function formatIncidentDetailInjuryDescription(value: string | null | undefined): string {
  if (!value || !value.trim()) return INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY;
  return value.trim();
}

/** Injury body location on the detail injury section when unset or blank. */
export function formatIncidentDetailInjuryBodyLocation(value: string | null | undefined): string {
  if (!value || !value.trim()) return INCIDENT_DETAIL_NO_BODY_LOCATION_COPY;
  return value.trim();
}
