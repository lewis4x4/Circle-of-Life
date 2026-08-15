import { formatDistanceToNow } from "date-fns";

/**
 * Quiet Operator copy for the facility detail audit tab diff preview.
 * Missing audit values name real gaps — never fabricate prior or new field text.
 */

export const AUDIT_TAB_NO_PREVIOUS_VALUE_COPY = "No previous value posted";
export const AUDIT_TAB_NO_NEW_VALUE_COPY = "No new value posted";
export const AUDIT_STRIP_NO_LAST_EVENT_COPY = "No events posted";
export const AUDIT_STRIP_NO_TOP_USER_COPY = "No activity posted";

/** Prior field value in the audit diff preview when unset, blank, or a lone em dash. */
export function formatAuditTabOldValue(value: string | null | undefined): string {
  if (value == null) return AUDIT_TAB_NO_PREVIOUS_VALUE_COPY;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return AUDIT_TAB_NO_PREVIOUS_VALUE_COPY;
  return trimmed;
}

/** New field value in the audit diff preview when unset, blank, or a lone em dash. */
export function formatAuditTabNewValue(value: string | null | undefined): string {
  if (value == null) return AUDIT_TAB_NO_NEW_VALUE_COPY;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return AUDIT_TAB_NO_NEW_VALUE_COPY;
  return trimmed;
}

/** Relative last-event label for the audit metrics strip when no events are on file. */
export function formatAuditStripLastEventRelative(lastEventAt: Date | null, formattedAgo: string): string {
  if (lastEventAt == null || Number.isNaN(lastEventAt.getTime())) return AUDIT_STRIP_NO_LAST_EVENT_COPY;
  return formattedAgo;
}

/** Relative last-event label for the audit tab summary line from an ISO timestamp string. */
export function formatAuditTabLastEventRelative(lastEventAt: string | null | undefined): string {
  const trimmed = lastEventAt?.trim();
  if (!trimmed) {
    return formatAuditStripLastEventRelative(null, "");
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return formatAuditStripLastEventRelative(null, "");
  }
  return formatAuditStripLastEventRelative(date, formatDistanceToNow(date, { addSuffix: true }));
}

/** Top-user tile on the audit metrics strip; real zero event counts stay explicit. */
export function formatAuditStripTopUserDisplay(
  topUserDisplay: string | null | undefined,
  eventsLast7d: number,
): string {
  const trimmed = topUserDisplay?.trim();
  if (trimmed) return trimmed;
  if (eventsLast7d > 0) return "Service session actors";
  return AUDIT_STRIP_NO_TOP_USER_COPY;
}

export function auditStripLastEventIsMissing(lastEventAt: Date | null): boolean {
  return lastEventAt == null || Number.isNaN(lastEventAt.getTime());
}
