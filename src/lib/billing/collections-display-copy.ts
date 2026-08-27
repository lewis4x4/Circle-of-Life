/**
 * Quiet Operator copy for billing collections activity log (`/admin/billing/collections`).
 * Missing resident names and follow-up dates name real gaps — never fabricate values.
 */

export const COLLECTIONS_NO_RESIDENT_NAME_COPY = "No resident name posted";
export const COLLECTIONS_NO_FOLLOW_UP_DATE_COPY = "No follow-up date posted";

/** Newest collection activities loaded for the hub. Older rows are not fetched. */
export const COLLECTIONS_HUB_LIMIT = 200;

/** Names the hub fetch ceiling so the activity log is not a silent 200-row slice. */
export function collectionsHubLoadCapNotice(
  loadedCount: number,
  loadedCap: number = COLLECTIONS_HUB_LIMIT,
): string | null {
  if (loadedCount < loadedCap) return null;
  return `Loaded the ${loadedCap} most recent collection activities. Older activities are not listed on this hub.`;
}

/** Resident name on a collection activity row when first/last are unset or blank. */
export function formatCollectionsResidentName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const parts = [first, last]
    .map((part) => (part == null ? "" : part.trim()))
    .filter(Boolean);
  if (parts.length === 0) return COLLECTIONS_NO_RESIDENT_NAME_COPY;
  return parts.join(" ");
}

/** Follow-up date on a collection activity row — posted value as-is, or explicit gap copy. */
export function formatCollectionsFollowUpDate(date: string | null | undefined): string {
  if (date == null) return COLLECTIONS_NO_FOLLOW_UP_DATE_COPY;
  const trimmed = date.trim();
  if (!trimmed || trimmed === "—") return COLLECTIONS_NO_FOLLOW_UP_DATE_COPY;
  return trimmed;
}

/** Whether a follow-up date is posted (chip UI) vs missing (gap copy). */
export function collectionsFollowUpDateIsPosted(date: string | null | undefined): boolean {
  return formatCollectionsFollowUpDate(date) !== COLLECTIONS_NO_FOLLOW_UP_DATE_COPY;
}
