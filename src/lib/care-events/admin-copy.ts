/**
 * Plain-words copy for the Administrator's care event card and completion form
 * (spec 07A §5) and the delivery ledger. Pure formatters, no IO.
 *
 * Reason chips are stored as codes; the labels never leave this file.
 * The word "nurse" never appears here; COL's audience is the Administrator or
 * Assistant.
 */

import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";

export type CodeOption = { code: string; label: string };

/** s. 429.23 adverse incident reasons, stored under answers.admin.ahca_reason. */
export const ahcaReasonOptions: readonly CodeOption[] = [
  { code: "death", label: "Death" },
  { code: "brain_spinal", label: "Brain or spinal damage" },
  { code: "disfigurement", label: "Permanent disfigurement" },
  { code: "fracture_dislocation", label: "Fracture or dislocation" },
  { code: "transfer_acute", label: "Transfer to more acute care" },
  { code: "law_enforcement", label: "Reported to law enforcement" },
  { code: "elopement_risk", label: "Elopement placing the resident at risk" },
];

/** Stored in care_events.level_change_reason. */
export const lowerLevelReasonOptions: readonly CodeOption[] = [
  { code: "reassessed_on_scene", label: "Reassessed on scene" },
  { code: "duplicate_report", label: "Duplicate report" },
  { code: "answered_in_error", label: "Answered in error" },
  { code: "administrator_judgment", label: "Administrator judgment" },
];

/** Section 4 of the paper form. `care_plan_review` also flips incidents.care_plan_updated. */
export const correctiveActionChips: readonly CodeOption[] = [
  { code: "care_plan_review", label: "Care plan review" },
  { code: "room_furniture_change", label: "Room or furniture change" },
  { code: "equipment_fixed", label: "Equipment fixed" },
  { code: "increased_checks", label: "Increased checks" },
  { code: "staff_retrained", label: "Staff retrained" },
  { code: "other", label: "Other" },
];

export const familyMethodOptions: readonly CodeOption[] = [
  { code: "phone", label: "Phone" },
  { code: "in_person", label: "In person" },
  { code: "text", label: "Text" },
];

export const emsTreatmentOptions: readonly CodeOption[] = [
  { code: "er_visit", label: "ER visit" },
  { code: "hospitalization", label: "Hospitalization" },
  { code: "none", label: "Not needed" },
];

export const videoSecuredOptions: readonly CodeOption[] = [
  { code: "yes", label: "Yes" },
  { code: "no", label: "No" },
  { code: "na", label: "Not applicable" },
];

function labelFor(options: readonly CodeOption[], code: string | null | undefined): string | null {
  if (!code) return null;
  return options.find((option) => option.code === code)?.label ?? null;
}

export function ahcaReasonLabel(code: string | null | undefined): string | null {
  return labelFor(ahcaReasonOptions, code);
}

export function lowerLevelReasonLabel(code: string | null | undefined): string {
  return labelFor(lowerLevelReasonOptions, code) ?? (code ? "Reason on file" : "No reason posted");
}

export function correctiveActionLabel(code: string): string {
  return labelFor(correctiveActionChips, code) ?? code.replace(/_/g, " ");
}

export function familyMethodLabel(code: string | null | undefined): string | null {
  return labelFor(familyMethodOptions, code);
}

export function emsTreatmentLabel(code: string | null | undefined): string | null {
  return labelFor(emsTreatmentOptions, code);
}

export function videoSecuredLabel(code: string | null | undefined): string | null {
  return labelFor(videoSecuredOptions, code);
}

/**
 * incidents.resolution_notes is written by the completion function as
 * "code; code; other text". Swap the known codes for their labels on screen.
 */
export function formatCorrectiveActionNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const parts = notes
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (correctiveActionChips.some((chip) => chip.code === part) ? correctiveActionLabel(part) : part));
  return parts.length > 0 ? parts.join("; ") : null;
}

// ---------------------------------------------------------------------------
// Close gate
// ---------------------------------------------------------------------------

export type CloseGateItem =
  | "acknowledgment"
  | "family_notified"
  | "physician_notified"
  | "ahca_decision"
  | "ems_decision"
  | "video_secured"
  | "dcf_report";

const CLOSE_GATE_WORDS: Record<CloseGateItem, string> = {
  acknowledgment: "acknowledgment",
  family_notified: "family decision",
  physician_notified: "physician decision",
  ahca_decision: "AHCA decision",
  ems_decision: "EMS decision",
  video_secured: "video decision",
  dcf_report: "DCF report",
};

export function isCloseGateItem(value: unknown): value is CloseGateItem {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CLOSE_GATE_WORDS, value);
}

/** "Still needed: family decision, physician decision, AHCA decision" or null when nothing is missing. */
export function careEventCloseGateLine(missing: readonly string[]): string | null {
  const words = missing.map((item) => (isCloseGateItem(item) ? CLOSE_GATE_WORDS[item] : item.replace(/_/g, " ")));
  if (words.length === 0) return null;
  return `Still needed: ${words.join(", ")}`;
}

export const CLOSE_READY_LINE = "Everything the level requires is on file.";

// ---------------------------------------------------------------------------
// Delivery ledger words
// ---------------------------------------------------------------------------

export type DeliveryChannel = "in_app" | "push" | "sms" | "voice";
export type DeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "skipped" | "acknowledged";

const CHANNEL_WORDS: Record<DeliveryChannel, string> = {
  in_app: "In app",
  push: "Push",
  sms: "Text",
  voice: "Voice call",
};

export function channelWord(channel: string): string {
  return (CHANNEL_WORDS as Record<string, string>)[channel] ?? "Alert";
}

const STATUS_WORDS: Record<DeliveryStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Did not go through",
  skipped: "Skipped",
  acknowledged: "Acknowledged",
};

export function deliveryStatusWord(status: string): string {
  return (STATUS_WORDS as Record<string, string>)[status] ?? "Recorded";
}

/** Plain words for care_event_deliveries.skip_reason. */
export function deliverySkipReasonLine(reason: string | null | undefined, channel?: string): string | null {
  if (!reason) return null;
  switch (reason) {
    case "channel_not_enabled":
      return `${channelWord(channel ?? "sms")} not enabled yet`;
    case "no_phone":
    case "no_phone_on_file":
      return "No phone on file";
    case "acknowledged":
      return "Acknowledged before sending";
    case "no_targets":
    case "no_target":
      return "Nobody is subscribed to this route";
    default:
      return `Skipped: ${reason.replace(/_/g, " ")}`;
  }
}

const TARGET_ROLE_WORDS: Record<string, string> = {
  route: "Administrator or Assistant",
  facility_admin: "Administrator",
  admin_assistant: "Assistant",
  administrator: "Administrator",
  assistant_administrator: "Assistant",
  on_call_primary: "On-call phone",
  on_call_secondary: "Backup on-call phone",
  owner: "Owner",
  org_admin: "Corporate",
  corporate: "Corporate",
  manager: "Manager",
  coordinator: "Coordinator",
};

/** A person's name when known, otherwise the role in plain words. */
export function deliveryTargetWord(targetName: string | null | undefined, targetRole: string | null | undefined): string {
  const name = targetName?.trim() ?? "";
  if (name) return name;
  const role = targetRole?.trim().toLowerCase() ?? "";
  if (!role) return "Administrator or Assistant";
  if (TARGET_ROLE_WORDS[role]) return TARGET_ROLE_WORDS[role];
  const words = role.replace(/_/g, " ").replace(/\bnurse\b/g, "Administrator or Assistant");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Time words
// ---------------------------------------------------------------------------

/** "10:07 PM" in the facility timezone, or null when the value is missing or unparseable. */
export function formatClockTime(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Just now", "4 minutes ago", "3 hours ago", "2 days ago". */
export function formatTimeSince(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "No time posted";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "No time posted";
  const elapsedSeconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

/** Whole minutes between two timestamps, never negative. */
export function minutesBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** "Acknowledged by Dana Whitfield at 10:07 PM" (or without a time). */
export function acknowledgedByLine(name: string | null | undefined, acknowledgedAtIso: string | null | undefined, timeZone: string): string {
  const who = name?.trim() || "the Administrator or Assistant";
  const time = formatClockTime(acknowledgedAtIso, timeZone);
  return time ? `Acknowledged by ${who} at ${time}` : `Acknowledged by ${who}`;
}

/** "Was Emergency, now Urgent, reason: Reassessed on scene". */
export function loweredLevelLine(fromLevel: number, toLevel: number, reasonCode: string | null | undefined): string {
  return `Was ${formatLevelWord(fromLevel)}, now ${formatLevelWord(toLevel)}, reason: ${lowerLevelReasonLabel(reasonCode)}`;
}

export function callReporterLabel(firstName: string | null | undefined): string {
  const first = firstName?.trim();
  return first ? `Call ${first}` : "Call the reporter";
}

export const NO_PHONE_ON_FILE_LABEL = "No phone on file";
export const PHOTO_UNAVAILABLE_LINE = "Photo unavailable";
