/**
 * Watchlist vocabulary and the copy the three tiers render. Spec 25A section 7.
 *
 * A resident carries named signals and a band, never a number. The old surface
 * put a 0 to 100 score on a resident row built partly out of whether staff
 * documented on time, so a resident lost twenty points because a caregiver ran
 * late and a reader saw decline. Nothing in this file turns a signal set into a
 * score, and nothing in it decides a band: the band arrives from the database,
 * where it is a row in `watchlist_band_rules`.
 *
 * "Monitoring Order", never "watch". "Watch" survives here only as the name of
 * a band, which is a different thing.
 *
 * No threshold, lookback span, baseline or severity boundary is written here.
 * Every one of them lives in `watchlist_signal_rules` and arrives with the row.
 */

import type { StatusPillTone } from "@/components/ui/status-pill";
import { formatPersonName } from "@/lib/format/datetime";

export const SIGNAL_STATUSES = ["new", "acknowledged", "plan_in_place", "cleared"] as const;

export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const BAND_KEYS = ["needs_a_look", "watch", "acute", "continued_residency_risk"] as const;

export type BandKey = (typeof BAND_KEYS)[number];

export type SourceKind = "clinical" | "data_quality";

export type SeverityClass = "informational" | "elevated" | "critical";

export type TrendDirection = "rising" | "steady" | "easing" | "unknown";

const STATUS_LABELS: Record<SignalStatus, string> = {
  new: "Not looked at",
  acknowledged: "Looked at",
  plan_in_place: "Plan in place",
  cleared: "Cleared",
};

const STATUS_TONES: Record<SignalStatus, StatusPillTone> = {
  new: "warning",
  acknowledged: "info",
  plan_in_place: "muted",
  cleared: "success",
};

const BAND_TONES: Record<BandKey, StatusPillTone> = {
  needs_a_look: "muted",
  watch: "warning",
  acute: "danger",
  continued_residency_risk: "danger",
};

const TREND_LABELS: Record<TrendDirection, string> = {
  rising: "More than the fortnight before",
  steady: "About the same as the fortnight before",
  easing: "Less than the fortnight before",
  unknown: "Not enough history yet",
};

export function signalStatusLabel(value: string): string {
  return STATUS_LABELS[value as SignalStatus] ?? "Not recorded";
}

export function signalStatusTone(value: string): StatusPillTone {
  return STATUS_TONES[value as SignalStatus] ?? "muted";
}

export function bandTone(value: string | null): StatusPillTone {
  if (!value) return "muted";
  return BAND_TONES[value as BandKey] ?? "muted";
}

export function trendLabel(value: string | null): string {
  if (!value) return TREND_LABELS.unknown;
  return TREND_LABELS[value as TrendDirection] ?? TREND_LABELS.unknown;
}

/**
 * The next disposition a reviewer can move a signal to. Forward only, which is
 * what the command enforces; this is the same order so the form never offers
 * something the database will refuse.
 */
export function nextDispositions(current: string): SignalStatus[] {
  const index = SIGNAL_STATUSES.indexOf(current as SignalStatus);
  if (index < 0) return [];
  return SIGNAL_STATUSES.slice(index + 1);
}

/** How long a signal has been open, in the words an operator would use. */
export function signalAgeLabel(daysOpen: number | null): string {
  if (daysOpen == null || Number.isNaN(daysOpen)) return "Not recorded";
  if (daysOpen <= 0) return "Today";
  if (daysOpen === 1) return "Since yesterday";
  return `${daysOpen} days`;
}

export function residentDisplayName(row: {
  resident_preferred_name?: string | null;
  resident_first_name?: string | null;
  resident_last_name?: string | null;
}): string {
  // "First Last", the one name format across Haven (COL-659).
  return formatPersonName(
    {
      first_name: row.resident_first_name,
      last_name: row.resident_last_name,
      preferred_name: row.resident_preferred_name,
    },
    { fallback: "Resident not named" },
  );
}

export function roomLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "No room recorded";
}

export function ownerLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Nobody yet";
}

/**
 * A documentation signal reports that nobody wrote the check down. Rendering it
 * in the same class as a fall is how a paperwork problem gets read as a resident
 * going downhill, which spec section 7.2 forbids.
 */
export function isDocumentationSignal(sourceKind: string | null | undefined): boolean {
  return sourceKind === "data_quality";
}

export function sourceKindLabel(sourceKind: string | null | undefined): string {
  return isDocumentationSignal(sourceKind) ? "Documentation" : "Clinical";
}

export function sourceKindTone(sourceKind: string | null | undefined): StatusPillTone {
  return isDocumentationSignal(sourceKind) ? "info" : "muted";
}

export type FacilityScope =
  | { kind: "all" }
  | { kind: "named"; name: string }
  | { kind: "missing_name" };

export function resolveWatchlistFacilityScope(
  facilityId: string | null,
  facilityName: string | undefined,
): FacilityScope {
  if (!facilityId) return { kind: "all" };
  const trimmed = facilityName?.trim();
  if (!trimmed) return { kind: "missing_name" };
  return { kind: "named", name: trimmed };
}

export function watchlistPageSubtitle(scope: FacilityScope): string {
  switch (scope.kind) {
    case "all":
      return "Every building you can reach, one row each.";
    case "named":
      return `Residents with open signals at ${scope.name}, ranked by band and then by how long they have been open.`;
    case "missing_name":
      return "Residents with open signals at the selected building, ranked by band and then by how long they have been open.";
  }
}

/** Left aligned, two lines, and it says what would put something here. */
export const WATCHLIST_EMPTY_STATE = {
  title: "Nobody is on the Watchlist at this building.",
  body: "A signal appears here when a rule in the signal list is met, which the scheduled evaluation checks for every resident.",
} as const;

export const PORTFOLIO_EMPTY_STATE = {
  title: "No buildings to show.",
  body: "The portfolio lists every building you have been granted access to; ask an administrator to add one.",
} as const;

export const LEDGER_EMPTY_STATE = {
  title: "Nothing has been dispositioned yet.",
  body: "Moving a signal forward and writing one line about what was done records a row here, and that record is what a surveyor reads.",
} as const;

export const SIGNAL_HISTORY_EMPTY_STATE = {
  title: "This resident has no signal history.",
  body: "Signals appear once the scheduled evaluation finds a rule met against this resident's records.",
} as const;

/**
 * The disposition ledger as a CSV, in the column order of the paper log it
 * replaces. Quoted defensively: a disposition line is free text and will
 * contain commas, quotes and newlines.
 */
export const LEDGER_CSV_HEADER = [
  "Date",
  "Resident",
  "Room",
  "Signal",
  "From",
  "To",
  "Reviewed by",
  "Role",
  "What was done",
] as const;

export interface LedgerCsvRow {
  acted_at: string;
  resident_name: string;
  room_number: string | null;
  signal_label: string;
  from_status: string | null;
  to_status: string;
  acted_by_name: string | null;
  acted_by_role: string | null;
  note: string | null;
  actor_kind: string;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildLedgerCsv(rows: readonly LedgerCsvRow[]): string {
  const lines = [LEDGER_CSV_HEADER.map((heading) => csvCell(heading)).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.acted_at,
        row.resident_name,
        roomLabel(row.room_number),
        row.signal_label,
        row.from_status ? signalStatusLabel(row.from_status) : "Opened",
        signalStatusLabel(row.to_status),
        row.actor_kind === "system" ? "Scheduled evaluation" : ownerLabel(row.acted_by_name),
        row.actor_kind === "system" ? "" : (row.acted_by_role ?? ""),
        row.note ?? "",
      ]
        .map((cell) => csvCell(cell))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function ledgerCsvFilename(facilityScope: FacilityScope, isoDate: string): string {
  const building = facilityScope.kind === "named" ? facilityScope.name : "watchlist";
  const slug = building.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug || "watchlist"}-disposition-ledger-${isoDate}.csv`;
}

/**
 * The evidence payload, in sentences.
 *
 * The payload names rows by id and carries the thresholds that were in force
 * when the signal fired, which is what makes a signal auditable. None of that
 * is operator copy: a uuid list and a table name on a resident record is the
 * developer text spec 25A defect 3 exists to remove. This turns the payload into
 * the lines a reviewer would say out loud, and drops everything it cannot say
 * that way rather than printing it raw.
 *
 * Anything this function does not recognise renders as nothing, not as JSON. A
 * signal whose evidence shape changes loses a line here and keeps its label,
 * its date and its disposition, which is a smaller failure than showing a
 * reviewer a blob.
 */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function asDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function formatSignalEvidence(
  signalKey: string,
  evidence: Record<string, unknown> | null | undefined,
): string[] {
  if (!evidence) return [];
  const lines: string[] = [];
  const lookback = asNumber(evidence.lookback_days);
  const baseline = asNumber(evidence.baseline_days);

  const events = asNumber(evidence.event_count);
  if (events != null && lookback != null) {
    lines.push(`${plural(events, "event", "events")} recorded in the last ${lookback} days.`);
  }

  const returns = asNumber(evidence.returned_count);
  if (returns != null && lookback != null) {
    lines.push(`${plural(returns, "hospital return", "hospital returns")} in the last ${lookback} days.`);
  }

  const logs = asCount(evidence.log_ids);
  if (logs != null && lookback != null) {
    lines.push(`Recorded on ${plural(logs, "observation", "observations")} in the last ${lookback} days.`);
  }

  const baselineCount = asNumber(evidence.baseline_count);
  if (baselineCount != null && baseline != null) {
    lines.push(
      baselineCount === 0
        ? `Not once in the ${baseline} days before that, which is what makes it a change.`
        : `${plural(baselineCount, "time", "times")} in the ${baseline} days before that.`,
    );
  }

  const nights = asNumber(evidence.night_count);
  if (nights != null && lookback != null) {
    lines.push(`Unsettled at the overnight check on ${nights} of the last ${lookback} nights.`);
  }

  const gap = asNumber(evidence.consecutive_unrecorded_windows);
  if (gap != null) {
    lines.push(`${plural(gap, "expected check", "expected checks")} in a row closed with nothing recorded.`);
  }

  const drop = asNumber(evidence.drop_percent);
  const threshold = asNumber(evidence.threshold_percent);
  if (drop != null && lookback != null) {
    lines.push(
      `Weight is down ${drop} percent from the highest reading in the last ${lookback} days${
        threshold != null ? `, against a threshold of ${threshold} percent` : ""
      }.`,
    );
  }
  const secondDrop = asNumber(evidence.secondary_drop_percent);
  const secondLookback = asNumber(evidence.secondary_lookback_days);
  if (secondDrop != null && secondLookback != null) {
    lines.push(`Down ${secondDrop} percent over the last ${secondLookback} days.`);
  }
  const weighedOn = asDate(evidence.latest_log_date);
  if (weighedOn) lines.push(`Last weighed ${weighedOn}.`);

  const interval = asNumber(evidence.interval_minutes);
  if (interval != null) {
    lines.push(`Monitoring Order running at ${interval} minute checks.`);
  }
  const reviewDue = asDate(evidence.review_due_at);
  if (reviewDue && signalKey === "monitoring_order_review_overdue") {
    lines.push(`Its review was due ${reviewDue}.`);
  } else if (reviewDue) {
    lines.push(`Review due ${reviewDue}.`);
  }

  const alerts = asNumber(evidence.alert_count);
  if (alerts != null) {
    lines.push(`${plural(alerts, "open care plan review alert", "open care plan review alerts")}.`);
  }

  const expires = asDate(evidence.expiration_date);
  if (expires) lines.push(`The current form expires ${expires}.`);

  const attendance = asNumber(evidence.baseline_attendances);
  if (attendance != null && lookback != null && baseline != null) {
    lines.push(
      `No activity attendance in the last ${lookback} days, against ${plural(attendance, "time", "times")} in the ${baseline} days before.`,
    );
  }

  return lines;
}
