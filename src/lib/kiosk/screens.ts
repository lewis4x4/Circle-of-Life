/**
 * Front-door kiosk formatting and the strings only the screens use (COL-692,
 * spec 40 §7). Visitor kinds, fields, form copy and the visitor lines live in
 * `contract.ts`, which the sign-in route shares. Client-safe.
 */

import type { KioskStaffState, PunchType } from "@/lib/timeclock/kiosk-contract";

export const KIOSK_TIME_ZONE = "America/New_York";

export const KIOSK_HOME_COPY = {
  brand: "Circle of Life",
  welcome: "Welcome. Tap who you are.",
  staffTitle: "Staff",
  staffSub: "Clock in, meal, clock out",
} as const;

export const KIOSK_SETUP_COPY = {
  title: "Set up this tablet",
  hint: "Ask an administrator for a one time enrollment code for the front-door kiosk. It expires 15 minutes after it is created.",
  codeLabel: "Enrollment code",
  nameLabel: "Tablet name",
  namePlaceholder: "HL-KIOSK-01",
  submit: "Set up",
  loading: "Starting the kiosk.",
} as const;

export const KIOSK_STAFF_COPY = {
  title: "Staff clock",
  numberLabel: "Employee number",
  pinLabel: "PIN",
  numberHelper: "Type your employee number, then tap Next.",
  pinHelper: "Now your 6-digit PIN.",
  next: "Next",
  continue: "Continue",
  privacy: "Stand so nobody behind you can see your PIN. Forgot it? Ask the administrator to reset it.",
  notYou: "Not you? Start over",
  chooseAction: "Choose what you are doing now.",
  offlineChoose: "Offline. Choose what you are doing now. It is checked when the tablet reconnects.",
  clears: "This screen clears in 5 seconds.",
  done: "Done",
} as const;

/** "You are off the clock." Off the clock adds the last clock out when the database knows it (kioskStaffStateLine). */
export const KIOSK_STAFF_STATE_LINE: Record<KioskStaffState, string> = {
  out: "You are off the clock.",
  in: "You are on the clock.",
  meal: "You are on a meal break.",
};

/** The floor-tablet card on the punch confirmation. */
export const KIOSK_FLOOR_TABLET_LINE: Record<PunchType, string> = {
  in: "Your name is on every floor tablet now. Grab any tablet, tap your name and enter your PIN.",
  meal_start: "Enjoy your meal. Your name stays on the floor tablets.",
  meal_end: "Welcome back. Your name is on every floor tablet.",
  out: "Your name is off the floor tablets now. Thank you for today.",
};

export const KIOSK_SIGN_IN_COPY = {
  submit: "Sign in",
  required: "(required)",
  signedInHeader: "Signed in",
  signedInTitle: "You're signed in.",
  fixFields: "Check the highlighted answers.",
} as const;

export const KIOSK_LEAVING_COPY = {
  title: "Signing out",
  hint: "Tap your name.",
  none: "No one signed in by that name. Please see the front desk.",
  searching: "Looking for your name.",
  signOut: "Sign out",
  doneTitle: "Signed out. Thank you for visiting.",
} as const;

export const KIOSK_BACK = "Back";

function timeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { hour: pick("hour"), minute: pick("minute"), period: pick("dayPeriod").toUpperCase() };
}

/** `6:58 AM` in the facility zone, with a plain space (ICU emits U+202F). */
export function formatKioskClock(value: string | Date, timeZone = KIOSK_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const { hour, minute, period } = timeParts(date, timeZone);
  return `${hour}:${minute} ${period}`;
}

/** `Thursday, October 1` in the facility zone. */
export function formatKioskDate(value: Date, timeZone = KIOSK_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(value);
}

/** `Wednesday, 7:06 PM` in the facility zone. */
export function formatKioskWeekdayTime(value: string, timeZone = KIOSK_TIME_ZONE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(date);
  return `${weekday}, ${formatKioskClock(date, timeZone)}`;
}

/** "You are off the clock. Last clock out: Wednesday, 7:06 PM." The clause is left off when there is no last clock out. */
export function kioskStaffStateLine(state: KioskStaffState, lastOutAt: string | null | undefined, timeZone = KIOSK_TIME_ZONE): string {
  const line = KIOSK_STAFF_STATE_LINE[state];
  const when = state === "out" && lastOutAt ? formatKioskWeekdayTime(lastOutAt, timeZone) : "";
  return when ? `${line} Last clock out: ${when}.` : line;
}

/** `Clocked in at 6:58 AM`. */
export function kioskPunchTitle(punchType: PunchType, punchedAt: string, timeZone = KIOSK_TIME_ZONE): string {
  const verb: Record<PunchType, string> = { in: "Clocked in", out: "Clocked out", meal_start: "Meal started", meal_end: "Meal ended" };
  return `${verb[punchType]} at ${formatKioskClock(punchedAt, timeZone)}`;
}

export function kioskSignedOutLine(displayName: string, checkedInAt: string, checkedOutAt: string, timeZone = KIOSK_TIME_ZONE): string {
  return `${displayName} · in ${formatKioskClock(checkedInAt, timeZone)} · out ${formatKioskClock(checkedOutAt, timeZone)}`;
}

/** A random UUID for idempotent kiosk writes. */
export function kioskRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
