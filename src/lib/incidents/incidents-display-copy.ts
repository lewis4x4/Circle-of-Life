/**
 * Quiet Operator copy for incident list/load date fields (`load-incidents.ts`).
 * Missing or unparseable dates name the gap — never invent timestamps or silent em dashes.
 */

export const INCIDENTS_NO_DATE_POSTED_COPY = "No date posted";

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
