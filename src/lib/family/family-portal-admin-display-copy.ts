/**
 * Quiet Operator copy for the admin Family Connections hub (`/admin/family-portal`).
 * Missing note bodies, rooms, keywords, resident names, and KPI scope name real gaps —
 * never fabricate family note text or conference details.
 */

export const FAMILY_PORTAL_ADMIN_NO_NOTE_COPY = "No note posted";
export const FAMILY_PORTAL_ADMIN_NO_ROOM_COPY = "No room posted";
export const FAMILY_PORTAL_ADMIN_NO_KEYWORDS_COPY = "No keywords posted";
export const FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY = "No resident name posted";

export type FamilyPortalAdminKpiKey =
  | "pending_triage"
  | "conferences_this_week"
  | "consents_expiring";

const KPI_NO_FACILITY_COPY: Record<FamilyPortalAdminKpiKey, string> = {
  pending_triage: "Select a facility to load triage counts",
  conferences_this_week: "Select a facility to load conferences",
  consents_expiring: "Select a facility to load consent counts",
};

function isBlankPostedValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "—";
}

/** Needs-attention KPI tile — numeric when facility scope is ready, explicit copy otherwise. */
export function familyPortalAdminKpiValue(
  key: FamilyPortalAdminKpiKey,
  facilityReady: boolean,
  value: number,
): string | number {
  if (!facilityReady) return KPI_NO_FACILITY_COPY[key];
  return value;
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
