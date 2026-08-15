/**
 * Quiet Operator copy for the admin resident care plan page
 * (`/admin/residents/[id]/care-plan`).
 * Missing titles, descriptions, versions, and dates name real gaps — never fabricate values.
 */

export const CARE_PLAN_NO_TITLE_COPY = "No title posted";
export const CARE_PLAN_NO_DESCRIPTION_COPY = "No description posted";
export const CARE_PLAN_NO_VERSION_COPY = "No version posted";
export const CARE_PLAN_NO_DATE_COPY = "No date posted";
export const CARE_PLAN_NO_NAME_COPY = "No name posted";

const LEGACY_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

export type CarePlanResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

function isMissingCarePlanResidentName(combined: string): boolean {
  const trimmed = combined.trim();
  if (trimmed.length === 0) return true;
  return LEGACY_PLACEHOLDER_RESIDENT_NAMES.has(trimmed.toLowerCase());
}

const CARE_PLAN_DATE_ONLY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/** Shared date-only formatter — noon UTC parse; missing / blank / unparseable → explicit empty copy. */
export function formatCarePlanDateOnly(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return CARE_PLAN_NO_DATE_COPY;
  const parsed = new Date(`${iso.trim()}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return CARE_PLAN_NO_DATE_COPY;
  return new Intl.DateTimeFormat("en-US", CARE_PLAN_DATE_ONLY_FORMAT).format(parsed);
}

/** Goal / intervention title when unset or blank. */
export function formatCarePlanItemTitle(title: string | null | undefined): string {
  if (!title || !title.trim()) return CARE_PLAN_NO_TITLE_COPY;
  return title;
}

/** Goal / intervention description when unset or blank. */
export function formatCarePlanItemDescription(description: string | null | undefined): string {
  if (!description || !description.trim()) return CARE_PLAN_NO_DESCRIPTION_COPY;
  return description;
}

/**
 * Care plan version — `v` + posted number when present, otherwise explicit empty copy alone.
 * Never renders `vNo version posted`.
 */
export function formatCarePlanVersion(version: number | null | undefined): string {
  if (version == null) return CARE_PLAN_NO_VERSION_COPY;
  const n = typeof version === "number" ? version : Number(version);
  if (Number.isNaN(n)) return CARE_PLAN_NO_VERSION_COPY;
  return `v${n}`;
}

/** Resident name on the care plan page when posted name is blank or legacy placeholder. */
export function formatCarePlanResidentName(resident: CarePlanResidentNameFields): string {
  const first = (resident.first_name ?? "").trim();
  const last = (resident.last_name ?? "").trim();
  const combined = `${first} ${last}`.trim();

  if (isMissingCarePlanResidentName(combined)) return CARE_PLAN_NO_NAME_COPY;
  return combined;
}
