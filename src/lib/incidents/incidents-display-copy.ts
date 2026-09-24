/**
 * Quiet Operator copy for incident list/load date fields (`load-incidents.ts`).
 * Missing or unparseable dates name the gap — never invent timestamps or silent em dashes.
 */

import { formatShortDateTime } from "@/lib/format/datetime";

export const INCIDENTS_NO_DATE_POSTED_COPY = "No date posted";
export const INCIDENTS_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const INCIDENTS_NO_NAME_POSTED_COPY = "No name posted";
export const INCIDENTS_NO_LEVEL_POSTED_COPY = "No level posted";

export type IncidentResidentNameParts = {
  first_name: string | null;
  last_name: string | null;
};

function isMissingIncidentDateInput(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "—" || trimmed === "Unknown";
}

/** Always in the facility zone, so server and client renders agree (COL-659). */
function formatPostedIncidentListTimestamp(value: string): string {
  return formatShortDateTime(value, { fallback: INCIDENTS_NO_DATE_POSTED_COPY });
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

export type IncidentLevelNumber = 1 | 2 | 3 | 4;

const INCIDENT_LEVEL_WORDS: Record<IncidentLevelNumber, string> = {
  1: "Note",
  2: "Heads-up",
  3: "Urgent",
  4: "Emergency",
};

/**
 * Level number from a stored severity. Accepts `level_n`, `"n"`, or the number n
 * for n in 1..4 (contract 07A §9). Anything else is null.
 */
export function levelNumberFromSeverity(
  value: number | string | null | undefined,
): IncidentLevelNumber | null {
  let candidate: number | null = null;
  if (typeof value === "number") {
    candidate = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^(?:level_)?([1-4])$/.exec(trimmed);
    candidate = match ? Number(match[1]) : null;
  }
  if (candidate === 1 || candidate === 2 || candidate === 3 || candidate === 4) return candidate;
  return null;
}

/** Plain level word for the caregiver banner and the incidents board. */
export function formatLevelWord(level: number | string | null | undefined): string {
  const number = levelNumberFromSeverity(level);
  return number === null ? INCIDENTS_NO_LEVEL_POSTED_COPY : INCIDENT_LEVEL_WORDS[number];
}

/**
 * Brian, 2026-09-23 (COL-689): incident severity is Note / Heads-up / Urgent / Emergency
 * everywhere, including the report form. Stored values stay `level_1`..`level_4`; forms
 * add a short guide after the word so the reporter can pick the right one.
 */
const INCIDENT_LEVEL_GUIDE: Record<IncidentLevelNumber, string> = {
  1: "minor or no injury",
  2: "minor injury or a repeat event",
  3: "moderate injury or a medication error",
  4: "major injury or a regulatory trigger",
};

export const INCIDENT_SEVERITY_VALUES = ["level_1", "level_2", "level_3", "level_4"] as const;
export type IncidentSeverityValue = (typeof INCIDENT_SEVERITY_VALUES)[number];

/** "Heads-up — minor injury or a repeat event", for a severity picker. */
export function formatSeverityChoice(level: number | string): string {
  const number = levelNumberFromSeverity(level);
  return number === null ? INCIDENTS_NO_LEVEL_POSTED_COPY : `${INCIDENT_LEVEL_WORDS[number]} — ${INCIDENT_LEVEL_GUIDE[number]}`;
}

/** `{ value, label }` for every severity; `withGuide` adds the short guide after the word. */
export function incidentSeverityOptions(withGuide: boolean): { value: IncidentSeverityValue; label: string }[] {
  return INCIDENT_SEVERITY_VALUES.map((value) => ({
    value,
    label: withGuide ? formatSeverityChoice(value) : formatLevelWord(value),
  }));
}

/**
 * Who reported an incident, in staff words (COL-689): the staff-record name first, then
 * the profile name unless it is a login handle or an email, then "Staff".
 */
export function formatIncidentReporterName(
  staff: { first_name: string | null; last_name: string | null } | null,
  profileFullName: string | null | undefined,
): string {
  const staffName = [staff?.first_name, staff?.last_name].map((part) => part?.trim() ?? "").filter(Boolean).join(" ");
  if (staffName) return staffName;
  const profileName = profileFullName?.trim() ?? "";
  const looksLikeHandle = profileName.includes("@") || /^[a-z0-9._-]+$/.test(profileName);
  return profileName && !looksLikeHandle ? profileName : "Staff";
}
