/**
 * Quiet Operator copy for the facility detail audit tab diff preview.
 * Missing audit values name real gaps — never fabricate prior or new field text.
 */

export const AUDIT_TAB_NO_PREVIOUS_VALUE_COPY = "No previous value posted";
export const AUDIT_TAB_NO_NEW_VALUE_COPY = "No new value posted";

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
