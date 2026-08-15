/**
 * Quiet Operator copy for assistant/coordinator dashboard family bulletin tiles.
 * Family portal is one-way (staff posts only) — never inbox or unread framing.
 */

export const FAMILY_BULLETIN_DASHBOARD_TILE_TITLE = "Family portal notes";

export const FAMILY_BULLETIN_DASHBOARD_TILE_SUBLABEL_ACTIVE =
  "Staff bulletin posts";

export const FAMILY_BULLETIN_DASHBOARD_TILE_EMPTY_SUBLABEL =
  "No bulletin notes posted yet";

export const FAMILY_BULLETIN_DASHBOARD_RECENT_SECTION_TITLE = "Recent bulletin notes";

export const FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_TITLE =
  "No bulletin notes posted yet";

export const FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_DESCRIPTION =
  "Post one-way updates from Family portal notes. Families can read them on the portal but cannot reply in Haven.";

export const FAMILY_BULLETIN_DASHBOARD_ACTION_LABEL = "Family portal notes";

/** Truncate bulletin body for dashboard preview rows. */
export function formatFamilyBulletinDashboardPreview(body: string | null | undefined): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return "No note text posted";
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}…`;
}
