/**
 * Quiet Operator copy for the admin HL7 inbound referral inbox
 * (`/admin/referrals/hl7-inbound`). Missing HL7 metadata names real gaps — never fabricate values.
 */

export const HL7_INBOUND_NO_MESSAGE_CONTROL_ID_COPY = "No message control id posted";
export const HL7_INBOUND_NO_TRIGGER_EVENT_COPY = "No trigger event posted";

/** Message control id on an inbound row when unset or blank. */
export function formatHl7InboundMessageControlId(
  messageControlId: string | null | undefined,
): string {
  if (!messageControlId || !messageControlId.trim()) {
    return HL7_INBOUND_NO_MESSAGE_CONTROL_ID_COPY;
  }
  return messageControlId.trim();
}

/** Trigger event on an inbound row when unset or blank. */
export function formatHl7InboundTriggerEvent(
  triggerEvent: string | null | undefined,
): string {
  if (!triggerEvent || !triggerEvent.trim()) {
    return HL7_INBOUND_NO_TRIGGER_EVENT_COPY;
  }
  return triggerEvent.trim();
}
