/**
 * Quiet Operator copy for the admin Family Connections hub (`/admin/family-portal`).
 * Missing note bodies, rooms, keywords, resident names, and KPI scope name real gaps —
 * never fabricate family note text or conference details.
 */

export const FAMILY_PORTAL_ADMIN_NO_NOTE_COPY = "No note posted";
export const FAMILY_PORTAL_ADMIN_NO_ROOM_COPY = "No room posted";
export const FAMILY_PORTAL_ADMIN_NO_KEYWORDS_COPY = "No keywords posted";
export const FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY = "No resident name posted";

export type FamilyPortalAdminFacilityScope =
  | { kind: "unscoped" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

const FAMILY_PORTAL_ADMIN_PAGE_DESCRIPTION_COPY =
  "Post one-way bulletin notes for families to read on the portal, surface staff notes that need clinical follow-up, track care conferences, and verify consent records for surveyor readiness.";

/** Page header facility scope — never fabricates a facility name. */
export function resolveFamilyPortalAdminFacilityScope(
  facilityReady: boolean,
  facilityName: string | null | undefined,
): FamilyPortalAdminFacilityScope {
  if (!facilityReady) return { kind: "unscoped" };
  const trimmed = facilityName?.trim();
  if (trimmed) return { kind: "named", name: trimmed };
  return { kind: "missing_name" };
}

/** Page subtitle — named scope may interpolate the facility name; the unscoped page is behind the facility gate (COL-651). */
export function formatFamilyPortalAdminPageSubtitle(scope: FamilyPortalAdminFacilityScope): string {
  if (scope.kind === "unscoped") {
    return FAMILY_PORTAL_ADMIN_PAGE_DESCRIPTION_COPY;
  }
  if (scope.kind === "named") {
    return `Family Connections at ${scope.name}. ${FAMILY_PORTAL_ADMIN_PAGE_DESCRIPTION_COPY}`;
  }
  return `Family Connections. ${FAMILY_PORTAL_ADMIN_PAGE_DESCRIPTION_COPY}`;
}

function isBlankPostedValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "—";
}

/** Posted bulletin note body on a triage row — trim only; never invents note text. */
export function formatFamilyPortalAdminNoteBody(body: string | null | undefined): string {
  const trimmed = body?.trim() ?? "";
  if (isBlankPostedValue(trimmed)) return FAMILY_PORTAL_ADMIN_NO_NOTE_COPY;
  return trimmed;
}

/** Conference external room id — trim only; never invents a room label. */
export function formatFamilyPortalAdminConferenceRoom(roomId: string | null | undefined): string {
  const trimmed = roomId?.trim() ?? "";
  if (isBlankPostedValue(trimmed)) return FAMILY_PORTAL_ADMIN_NO_ROOM_COPY;
  return trimmed;
}

/** Matched triage keywords when none were flagged on the posted note. */
export function formatFamilyPortalAdminMatchedKeywords(
  keywords: string[] | null | undefined,
): string {
  const list = keywords ?? [];
  if (list.length === 0) return FAMILY_PORTAL_ADMIN_NO_KEYWORDS_COPY;
  return list.join(", ");
}

/** Resident name on a triage, conference, or consent row when the join is unset or blank. */
export function formatFamilyPortalAdminResidentName(
  resident: { first_name: string; last_name: string } | null | undefined,
): string {
  if (!resident) return FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY;
  const parts = [resident.first_name, resident.last_name]
    .map((part) => (part == null ? "" : part.trim()))
    .filter(Boolean);
  if (parts.length === 0) return FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY;
  return parts.join(" ");
}
