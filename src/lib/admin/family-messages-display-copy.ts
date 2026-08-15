/**
 * Quiet Operator copy for the staff family messages inbox.
 * Missing resident, room, and author labels name real gaps — never silent dashes or fabricated names.
 */

export const FAMILY_MESSAGES_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const FAMILY_MESSAGES_NO_NAME_POSTED_COPY = "No name posted";
export const FAMILY_MESSAGES_NO_ROOM_POSTED_COPY = "No room posted";
export const FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY = "No author posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

export type FamilyMessagesResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

/** Trim/join resident name fields — no fabricated fallback. */
export function residentNameFromFields(r: FamilyMessagesResidentNameFields): string {
  return `${r.first_name?.trim() ?? ""} ${r.last_name?.trim() ?? ""}`.trim();
}

/** Resident label on a staff inbox thread when the row or name is unset, blank, or em dash. */
export function formatFamilyMessagesResidentLabel(
  resident: FamilyMessagesResidentNameFields | null | undefined,
): string {
  if (!resident) return FAMILY_MESSAGES_NO_RESIDENT_POSTED_COPY;
  const name = residentNameFromFields(resident);
  if (isBlankOrEmDash(name)) return FAMILY_MESSAGES_NO_NAME_POSTED_COPY;
  return name;
}

/** Room label on a staff inbox thread when unset, blank, or em dash. */
export function formatFamilyMessagesRoomLabel(roomLabel: string | null | undefined): string {
  if (isBlankOrEmDash(roomLabel)) return FAMILY_MESSAGES_NO_ROOM_POSTED_COPY;
  return String(roomLabel).trim();
}

/** Author name on a staff inbox message when unset, blank, or em dash. */
export function formatFamilyMessagesAuthorName(authorName: string | null | undefined): string {
  if (isBlankOrEmDash(authorName)) return FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY;
  return String(authorName).trim();
}
