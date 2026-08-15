/**
 * Quiet Operator copy for the v2 settings audit log table.
 * Missing facility, actor, and note values name real gaps — never fabricate IDs or notes.
 */

export const AUDIT_LOG_NO_FACILITY_COPY = "No facility posted";
export const AUDIT_LOG_NO_ACTOR_COPY = "No actor posted";
export const AUDIT_LOG_NO_NOTE_COPY = "No note posted";

function isBlankValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  return value.trim().length === 0;
}

/** True when a facility id is present and non-blank. */
export function auditLogFacilityIdIsPosted(
  facilityId: string | null | undefined,
): boolean {
  return !isBlankValue(facilityId);
}

/** True when an actor id is present and non-blank. */
export function auditLogActorIdIsPosted(actorId: string | null | undefined): boolean {
  return !isBlankValue(actorId);
}

function formatTruncatedId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 8) return `${trimmed.slice(0, 8)}…`;
  return trimmed;
}

/** Facility column when unset or blank. Posted IDs truncate to the first eight characters. */
export function formatAuditLogFacilityIdDisplay(
  facilityId: string | null | undefined,
): string {
  const trimmed = facilityId?.trim() ?? "";
  if (!trimmed) return AUDIT_LOG_NO_FACILITY_COPY;
  return formatTruncatedId(trimmed);
}

/** Actor column when unset or blank. Posted IDs truncate to the first eight characters. */
export function formatAuditLogActorIdDisplay(
  actorId: string | null | undefined,
): string {
  const trimmed = actorId?.trim() ?? "";
  if (!trimmed) return AUDIT_LOG_NO_ACTOR_COPY;
  return formatTruncatedId(trimmed);
}

/** Note column when unset or blank. Posted notes return trimmed text as-is. */
export function formatAuditLogNoteDisplay(note: string | null | undefined): string {
  const trimmed = note?.trim() ?? "";
  if (!trimmed) return AUDIT_LOG_NO_NOTE_COPY;
  return trimmed;
}
