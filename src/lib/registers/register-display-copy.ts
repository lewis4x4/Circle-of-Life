/** Eastern is the only timezone a Florida ALF register is read in. */
const EASTERN = "America/New_York";

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const monthOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

export function formatRegisterEventTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatRegisterEventDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/**
 * A census month is a calendar month, not an instant, so it is formatted in UTC
 * to stop a midnight-Eastern date from being read back as the month before.
 */
export function formatCensusMonth(month: string): string {
  return monthOnly.format(new Date(`${month.slice(0, 10)}T12:00:00Z`));
}

/** `2026-01-05` for a date input, in Eastern rather than the browser's zone. */
export function easternDateInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

export function daysAgoEastern(days: number, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return easternDateInputValue(shifted);
}

export function monthsAgoEastern(months: number, now: Date = new Date()): string {
  const today = easternDateInputValue(now);
  const [y, m, d] = today.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  // Clamp rather than overflow: six months before August 31 is February 28, not
  // March 3, and a range that quietly jumps a month is a range nobody trusts.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * How far Eastern is from UTC at a given instant. Read from the zone database
 * rather than assumed, because half the year the answer is five hours and half
 * the year it is four, and a register printed across a March boundary would
 * otherwise start an hour into the wrong day.
 */
function easternOffsetMs(at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT-05:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 5 * 60 * 60 * 1000;
  const sign = match[1] === "-" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
}

/** The instant an Eastern calendar day begins. */
export function easternDayStartIso(date: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const candidate = new Date(guess.getTime() + easternOffsetMs(guess));
  return new Date(guess.getTime() + easternOffsetMs(candidate)).toISOString();
}

/**
 * The register range is half open, matching the SQL: an event at exactly the
 * end instant belongs to the next range. This returns the start of the day
 * after the chosen end date so the chosen end date itself is included.
 */
export function easternDayEndIso(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return easternDayStartIso(next.toISOString().slice(0, 10));
}

export function formatSurveyPackFooter(args: {
  printedByName: string;
  printedAt: Date;
  facilityName: string;
}): string {
  return `Printed from Haven by ${args.printedByName} on ${dateTime.format(args.printedAt)} Eastern`;
}

export function formatElapsedSince(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
