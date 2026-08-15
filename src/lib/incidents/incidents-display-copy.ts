/**
 * Quiet Operator copy for incident list/load date fields (`load-incidents.ts`).
 * Missing or unparseable dates name the gap — never invent timestamps or silent em dashes.
 */

export const INCIDENTS_NO_DATE_POSTED_COPY = "No date posted";
export const INCIDENTS_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const INCIDENTS_NO_NAME_POSTED_COPY = "No name posted";

export type IncidentResidentNameParts = {
  first_name: string | null;
  last_name: string | null;
};

const INCIDENTS_LIST_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function isMissingIncidentDateInput(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "—" || trimmed === "Unknown";
}

function formatPostedIncidentListTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return INCIDENTS_NO_DATE_POSTED_COPY;
  return new Intl.DateTimeFormat("en-US", INCIDENTS_LIST_TIMESTAMP_FORMAT).format(parsed);
}

/** Occurred-at on the incidents board when missing, blank, em dash, legacy Unknown, or unparseable. */
export function formatIncidentOccurredAt(value: string | null | undefined): string {
  if (isMissingIncidentDateInput(value)) return INCIDENTS_NO_DATE_POSTED_COPY;
  return formatPostedIncidentListTimestamp(value!.trim());
}

/** Next follow-up due on the incidents board when missing, blank, em dash, or unparseable. */
export function formatIncidentFollowupDue(value: string | null | undefined): string {
  if (isMissingIncidentDateInput(value)) return INCIDENTS_NO_DATE_POSTED_COPY;
  return formatPostedIncidentListTimestamp(value!.trim());
}

const LEGACY_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

function isMissingIncidentResidentName(combined: string): boolean {
  const trimmed = combined.trim();
  if (trimmed.length === 0) return true;
  return LEGACY_PLACEHOLDER_RESIDENT_NAMES.has(trimmed.toLowerCase());
}

/** Resident name on the incidents board when join is missing or posted name is blank/legacy placeholder. */
export function formatIncidentResidentName(
  resident: IncidentResidentNameParts | null | undefined,
): string {
  if (resident == null) return INCIDENTS_NO_RESIDENT_POSTED_COPY;

  const first = (resident.first_name ?? "").trim();
  const last = (resident.last_name ?? "").trim();
  const combined = `${first} ${last}`.trim();

  if (isMissingIncidentResidentName(combined)) return INCIDENTS_NO_NAME_POSTED_COPY;
  return combined;
}
