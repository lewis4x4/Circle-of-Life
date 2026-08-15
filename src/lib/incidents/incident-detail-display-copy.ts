/**
 * Quiet Operator copy for the admin incident detail page (`/admin/incidents/[id]`).
 * Missing injury and fall fields name real gaps — never fabricate clinical text or resident names.
 */

export const INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY = "No injury description posted";
export const INCIDENT_DETAIL_NO_BODY_LOCATION_COPY = "No body location posted";
export const INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY = "No severity posted";
export const INCIDENT_DETAIL_NO_FALL_WITNESSED_COPY = "No witnessed status posted";
export const INCIDENT_DETAIL_NO_FALL_TYPE_COPY = "No fall type posted";
export const INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY = "No activity posted";
export const INCIDENT_DETAIL_NO_DATE_COPY = "No date posted";

const INCIDENT_DETAIL_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function formatSnake(value: string): string {
  return value.replace(/_/g, " ");
}

/** Injury severity on the detail injury section when unset, blank, or a lone em dash. */
export function formatIncidentDetailInjurySeverity(value: string | null | undefined): string {
  if (value == null) return INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "—") return INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY;
  return formatSnake(trimmed);
}

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

/** Fall witnessed status on the detail fall section when unset. Posted true/false stay Yes/No. */
export function formatIncidentDetailFallWitnessed(value: boolean | null | undefined): string {
  if (value == null) return INCIDENT_DETAIL_NO_FALL_WITNESSED_COPY;
  return value ? "Yes" : "No";
}

/** Fall type on the detail fall section when unset or blank. */
export function formatIncidentDetailFallType(value: string | null | undefined): string {
  if (!value || !value.trim()) return INCIDENT_DETAIL_NO_FALL_TYPE_COPY;
  return formatSnake(value.trim());
}

/** Fall activity on the detail fall section when unset or blank. */
export function formatIncidentDetailFallActivity(value: string | null | undefined): string {
  if (!value || !value.trim()) return INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY;
  return formatSnake(value.trim());
}

/** Timestamp on the detail page — never invents a date/time. */
export function formatIncidentDetailTimestamp(value: string | null | undefined): string {
  if (!value || !value.trim()) return INCIDENT_DETAIL_NO_DATE_COPY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return INCIDENT_DETAIL_NO_DATE_COPY;
  return new Intl.DateTimeFormat("en-US", INCIDENT_DETAIL_TIMESTAMP_FORMAT).format(parsed);
}
