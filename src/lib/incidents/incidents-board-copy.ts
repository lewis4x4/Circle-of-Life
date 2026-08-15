/**
 * Quiet Operator copy for the admin incidents kanban (`/admin/incidents`).
 * Empty states name real gaps — never fabricate incidents, follow-ups, or RCA cards.
 */

/** Load-layer sentinel when no next follow-up due exists — never render in UI. */
export const INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL = "—";

export function adminIncidentsKanbanColumnEmptyTitle(): string {
  return "No incidents in this column";
}

export function adminIncidentsKanbanColumnEmptyHelper(): string {
  return "Open, in-progress, and closed stay in their own columns.";
}

/** When a facility is selected but the live query returned zero rows. */
export function adminIncidentsGlobalEmptyNotice(): string {
  return "No live incident records returned for this scope. No fallback incident cards are not shown.";
}

/** When the header facility selector has no valid site — avoids a broken-looking board. */
export function adminIncidentsNoFacilityNotice(): string {
  return "Select a facility in the header to load incident records for that site.";
}

/**
 * Label for a follow-up due badge. Returns null when there is no due date to show
 * (omit the badge). Never returns the load-layer dash sentinel.
 */
export function formatIncidentFollowupDueLabel(input: {
  followupDueMs: number;
  followupDueStr: string;
}): string | null {
  if (input.followupDueMs <= 0) return null;
  const trimmed = input.followupDueStr.trim();
  if (!trimmed || trimmed === INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL) return null;
  return trimmed;
}

/** Full badge text when a follow-up due date should be shown. */
export function incidentFollowupDueBadgeText(input: {
  followupDueMs: number;
  followupDueStr: string;
}): string | null {
  const dueLabel = formatIncidentFollowupDueLabel(input);
  if (!dueLabel) return null;
  return `Next due ${dueLabel}`;
}
