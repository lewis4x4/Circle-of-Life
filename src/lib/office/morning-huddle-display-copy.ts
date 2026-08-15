/**
 * Quiet Operator copy for the morning huddle data loader.
 * Missing joins and blank names name real gaps — never silent em dashes, legacy Unknown, or fabricated names.
 */

export const MORNING_HUDDLE_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const MORNING_HUDDLE_NO_STAFF_POSTED_COPY = "No staff posted";
export const MORNING_HUDDLE_NO_NAME_POSTED_COPY = "No name posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";

export type MorningHuddlePersonNameFields = {
  first_name?: string | null;
  last_name?: string | null;
};

function sanitizeNameField(value: string | null | undefined): string {
  if (value == null) return "";
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === EM_DASH || trimmed === LEGACY_UNKNOWN) return "";
  return trimmed;
}

function personNameFromFields(p: MorningHuddlePersonNameFields): string {
  const first = sanitizeNameField(p.first_name);
  const last = sanitizeNameField(p.last_name);
  return `${first} ${last}`.trim();
}

/** Resident label when the join or name is unset, blank, em dash, or legacy Unknown. */
export function formatMorningHuddleResidentName(
  resident: MorningHuddlePersonNameFields | null | undefined,
): string {
  if (!resident) return MORNING_HUDDLE_NO_RESIDENT_POSTED_COPY;
  const name = personNameFromFields(resident);
  if (!name) return MORNING_HUDDLE_NO_NAME_POSTED_COPY;
  return name;
}

/** Staff label on shift roster rows when the join or name is unset, blank, em dash, or legacy Unknown. */
export function formatMorningHuddleStaffName(
  staff: MorningHuddlePersonNameFields | null | undefined,
): string {
  if (!staff) return MORNING_HUDDLE_NO_STAFF_POSTED_COPY;
  const name = personNameFromFields(staff);
  if (!name) return MORNING_HUDDLE_NO_NAME_POSTED_COPY;
  return name;
}
