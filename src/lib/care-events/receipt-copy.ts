/**
 * Receipt screen copy (spec 07A §2 "Receipt screen"). Pure formatters, no IO.
 * Channel words: push "push", in_app "the Today board", sms "text", voice "voice call".
 * The word "nurse" never appears here; COL's escalation audience is the
 * Administrator or Assistant.
 */

import type {
  CareEventDeliveryChannel,
  CareEventDeliveryStatus,
  CareEventReceiptDelivery,
} from "./submit";

export const RECEIPT_OFFLINE_SAVED_LINE = "Saved on this device, sending when back online.";
export const RECEIPT_ON_CALL_UNAVAILABLE_LINE = "On-call phone not available on this device.";
export const RECEIPT_TRANSCRIPTION_FAILED_LINE =
  "The voice note could not be transcribed. The event is saved; tell the Administrator or Assistant in person.";
export const RECEIPT_PHOTO_FAILED_LINE = "The photo did not upload. The event is saved; try the photo again.";

/** "10:06 PM" in the facility timezone. */
export function formatReceiptTime(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

/** "P. Brownell" from a first and last name; falls back to whatever is present. */
export function formatResidentShortName(firstName: string | null, lastName: string | null): string {
  const first = firstName?.trim() ?? "";
  const last = lastName?.trim() ?? "";
  if (first && last) return `${first.charAt(0).toUpperCase()}. ${last}`;
  return last || first || "the resident";
}

export function savedLine(input: {
  residentFirstName: string | null;
  residentLastName: string | null;
  hasResident: boolean;
  savedAtIso: string | null;
  timeZone: string;
}): string {
  const time = formatReceiptTime(input.savedAtIso, input.timeZone);
  const target = input.hasResident
    ? `${formatResidentShortName(input.residentFirstName, input.residentLastName)}'s log`
    : "the building log";
  return time ? `Saved to ${target} at ${time}.` : `Saved to ${target}.`;
}

const CHANNEL_WORDS: Record<CareEventDeliveryChannel, string> = {
  push: "push",
  in_app: "the Today board",
  sms: "text",
  voice: "voice call",
};

const CHANNEL_NOUNS: Record<CareEventDeliveryChannel, string> = {
  push: "Push alert",
  in_app: "The Today board",
  sms: "Text message",
  voice: "Voice call",
};

export function channelWord(channel: CareEventDeliveryChannel): string {
  return CHANNEL_WORDS[channel];
}

const TARGET_WORDS: Record<string, string> = {
  route: "Administrator or Assistant",
  facility_admin: "Administrator",
  admin_assistant: "Assistant",
  administrator: "Administrator",
  assistant_administrator: "Assistant",
  on_call_primary: "On-call phone",
  on_call_secondary: "Backup on-call phone",
  owner: "Owner",
  corporate: "Corporate",
};

/** A person's full name when the server had one, otherwise the plain-words role. */
export function targetWord(delivery: Pick<CareEventReceiptDelivery, "target_name" | "target_role">): string {
  const name = delivery.target_name?.trim() ?? "";
  const role = delivery.target_role?.trim() ?? "";
  const raw = name || role;
  const key = raw.toLowerCase();
  if (!raw) return "Administrator or Assistant";
  if (TARGET_WORDS[key]) return TARGET_WORDS[key];
  // A person's full name or a route's display name: keep the server's casing.
  if (!/_/.test(raw) && !/\bnurse\b/i.test(raw)) return raw;
  const words = key.replace(/_/g, " ").replace(/\bnurse\b/g, "Administrator or Assistant");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type DeliveryLineInput = {
  target_name: string | null;
  target_role: string | null;
  channel: CareEventDeliveryChannel;
  status: CareEventDeliveryStatus;
  sent_at?: string | null;
  skip_reason?: string | null;
};

/** One line per delivery row. Acknowledged rows are summarized by `acknowledgedLine` instead. */
export function deliveryLine(delivery: DeliveryLineInput, timeZone: string): string {
  const who = targetWord(delivery);
  const via = channelWord(delivery.channel);
  const time = formatReceiptTime(delivery.sent_at, timeZone);
  switch (delivery.status) {
    case "skipped":
      return delivery.skip_reason === "channel_not_enabled"
        ? `${CHANNEL_NOUNS[delivery.channel]} not enabled yet.`
        : `${CHANNEL_NOUNS[delivery.channel]} to ${who} was skipped.`;
    case "failed":
      return `${CHANNEL_NOUNS[delivery.channel]} to ${who} did not go through. Tell them in person.`;
    case "queued":
      return `Alerting ${who} by ${via}.`;
    case "acknowledged":
      return `${who} acknowledged.`;
    case "sent":
    case "delivered":
    default:
      return time
        ? `${who} alerted by ${via} at ${time}. Waiting for acknowledgment.`
        : `${who} alerted by ${via}. Waiting for acknowledgment.`;
  }
}

export function acknowledgedLine(fullName: string | null, acknowledgedAtIso: string | null, timeZone: string): string {
  const who = fullName?.trim() || "the Administrator or Assistant";
  const time = formatReceiptTime(acknowledgedAtIso, timeZone);
  return time ? `Acknowledged by ${who} at ${time}.` : `Acknowledged by ${who}.`;
}

export function nextCheckLine(nextCheckAtIso: string | null, timeZone: string): string | null {
  const time = formatReceiptTime(nextCheckAtIso, timeZone);
  return time ? `Next for you: check on them again at ${time}.` : null;
}

export function incidentLine(incidentNumber: string | null): string | null {
  return incidentNumber ? `Incident ${incidentNumber}` : null;
}

export function onCallLine(phone: string | null): string {
  return phone ? `Call the on-call phone now: ${phone}` : RECEIPT_ON_CALL_UNAVAILABLE_LINE;
}

/** Level 1 has no deliveries by design; say so instead of showing nothing. */
export const RECEIPT_NOTE_ONLY_LINE =
  "Nobody was interrupted. It shows on the Administrator's board and in the next shift handoff.";
