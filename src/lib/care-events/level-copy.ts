/**
 * Plain-words copy keyed by care event level (spec 07A §2 and §4).
 * The send button label already says what will happen; the consequence
 * line spells it out under the live banner.
 */

import {
  CARE_EVENT_CALL_911_KINDS,
  type CareEventFlags,
  type CareEventKind,
  type CareEventLevel,
} from "./level-engine";

const SEND_BUTTON_LABELS: Record<CareEventLevel, string> = {
  1: "Save to log",
  2: "Save and alert the Administrator",
  3: "Send urgent alert",
  4: "Send emergency alert",
};

const CONSEQUENCE_LINES: Record<CareEventLevel, string> = {
  1: "Saved to the log. Nobody is interrupted. It shows on the Administrator's board and in the next shift handoff.",
  2: "The on-shift Administrator or Assistant gets a push alert and must acknowledge.",
  3: "The Administrator or Assistant and the on-call phone get an urgent alert by push and text.",
  4: "Everyone on the emergency route is alerted at once by push, text, and voice.",
};

export const CARE_EVENT_CALL_911_LINE = "Call 911 first if you have not. Then send.";

export const careEventEmarReminderLine = "Also mark it in the eMAR.";

export function careEventSendButtonLabel(level: CareEventLevel): string {
  return SEND_BUTTON_LABELS[level];
}

export function careEventConsequenceLine(level: CareEventLevel): string {
  return CONSEQUENCE_LINES[level];
}

/**
 * The 911 interstitial shows only when the engine set `call_911_prompt`,
 * which already limits it to Fall, Sick, Wandering, and Building danger at Level 4.
 * The kind check is belt and suspenders against a flag object built elsewhere.
 */
export function careEventShowsCall911Line(kind: CareEventKind, flags: CareEventFlags): boolean {
  return flags.call_911_prompt === true && CARE_EVENT_CALL_911_KINDS.includes(kind);
}
