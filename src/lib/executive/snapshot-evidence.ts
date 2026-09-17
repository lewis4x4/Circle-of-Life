/**
 * Executive snapshot evidence — when the figures on the overview were recorded,
 * and what denominators they were computed from.
 *
 * The overview reads two shapes of the same nightly run: `exec_metric_snapshots`
 * (one numeric per metric, what the tiles display) and `exec_kpi_snapshots`
 * (the full payload the run computed from). Only the second one carries the
 * evidence an owner needs to interpret a figure — the run time, the census the
 * incident rate was divided by, and the period billed revenue covers.
 *
 * Nothing here computes a metric. A missing snapshot stays missing; a recorded
 * zero stays zero. The distinction between the two is the point of this module.
 */

export const INCIDENT_RATE_WINDOW_DAYS = 30;

export type ExecutiveSnapshotEvidence = {
  /** Operating day the run covers (YYYY-MM-DD). */
  snapshotDate: string;
  /** When the run executed (ISO, UTC). */
  computedAt: string | null;
  /** Residents in census at run time — the incident-rate denominator basis. */
  occupiedResidents: number | null;
  /** Licensed beds the run used for its own occupancy figure. */
  licensedBeds: number | null;
  incidentRatePer1kResidentDays: number | null;
  billedRevenueMtdCents: number | null;
  laborCostMtdCents: number | null;
};

export type ExecutiveSnapshotState =
  /** No run has ever been recorded for this organization. */
  | { kind: "never_recorded" }
  /** The run record could not be read — freshness is unknown, not current. */
  | { kind: "unreadable"; message: string }
  | { kind: "recorded"; evidence: ExecutiveSnapshotEvidence; ageDays: number; stale: boolean };

/** A run older than this is reported as past evidence rather than current state. */
export const SNAPSHOT_STALE_AFTER_DAYS = 1;

type SnapshotRow = {
  snapshot_date: string;
  computed_at: string | null;
  metrics: unknown;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Pull the interpretable evidence out of a stored run payload. Absent keys stay null. */
export function readSnapshotEvidence(row: SnapshotRow): ExecutiveSnapshotEvidence {
  const metrics = record(row.metrics);
  const census = record(metrics?.census);
  const clinical = record(metrics?.clinical);
  const financial = record(metrics?.financial);
  const workforce = record(metrics?.workforce);

  return {
    snapshotDate: row.snapshot_date,
    computedAt: row.computed_at,
    occupiedResidents: numberOrNull(census?.occupiedResidents),
    licensedBeds: numberOrNull(census?.licensedBeds),
    incidentRatePer1kResidentDays: numberOrNull(clinical?.incidentRatePer1kResidentDays),
    billedRevenueMtdCents: numberOrNull(financial?.billedRevenueMtdCents),
    laborCostMtdCents: numberOrNull(workforce?.laborCostMtdCents),
  };
}

/**
 * Today where the facilities are, not where the browser is. Snapshot ages are
 * read against the operating day an administrator would name.
 */
export function facilityTodayIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function wholeDaysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00.000Z`);
  const to = Date.parse(`${toIsoDate}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Four outcomes kept apart: read failed, nothing recorded, recorded today,
 * recorded earlier. A failed read is never reported as "nothing to report".
 */
export function resolveSnapshotState(input: {
  row: SnapshotRow | null;
  errorMessage?: string | null;
  todayIsoDate: string;
}): ExecutiveSnapshotState {
  if (input.errorMessage) {
    return { kind: "unreadable", message: input.errorMessage };
  }
  if (!input.row) {
    return { kind: "never_recorded" };
  }
  const evidence = readSnapshotEvidence(input.row);
  const ageDays = wholeDaysBetween(evidence.snapshotDate, input.todayIsoDate);
  return {
    kind: "recorded",
    evidence,
    ageDays,
    stale: ageDays >= SNAPSHOT_STALE_AFTER_DAYS,
  };
}

/** Header line — states when the figures were recorded, or that nothing was. */
export function snapshotFreshnessLine(state: ExecutiveSnapshotState): string {
  switch (state.kind) {
    case "never_recorded":
      return "No portfolio figures have been recorded yet. Census and rounding sections below read live.";
    case "unreadable":
      return "The recording time for these figures could not be read — treat their age as unknown.";
    case "recorded": {
      if (!state.stale) {
        return `Portfolio figures recorded ${state.evidence.snapshotDate} (today).`;
      }
      const dayWord = state.ageDays === 1 ? "day" : "days";
      return `Portfolio figures recorded ${state.evidence.snapshotDate} — ${state.ageDays} ${dayWord} ago. They describe that day, not today.`;
    }
  }
}

/**
 * How old one displayed figure is, independently of the run that last executed.
 *
 * A run only writes a metric it could compute, so a measure that went
 * unavailable for a day leaves yesterday's value as the newest one. Ageing the
 * whole page off the run's date would report that value as current.
 */
export type MetricFreshness =
  /** Recorded on the operating day this page is being read. */
  | { kind: "current"; date: string }
  /** Recorded earlier — the figure describes that day, not today. */
  | { kind: "earlier"; date: string; ageDays: number }
  /** The value arrived without a recorded day, so its age is unknown. */
  | { kind: "undated" };

/** Age one metric against the facilities' operating day, not against the run. */
export function metricFreshness(
  metricDate: string | null | undefined,
  todayIsoDate: string,
): MetricFreshness {
  if (!metricDate) return { kind: "undated" };
  const ageDays = wholeDaysBetween(metricDate, todayIsoDate);
  if (ageDays < SNAPSHOT_STALE_AFTER_DAYS) return { kind: "current", date: metricDate };
  return { kind: "earlier", date: metricDate, ageDays };
}

/** "Recorded 2026-09-12, 3 days ago." — the same sentence the run uses. */
export function metricRecordedLine(freshness: MetricFreshness): string | null {
  if (freshness.kind !== "earlier") return null;
  const dayWord = freshness.ageDays === 1 ? "day" : "days";
  return `Recorded ${freshness.date}, ${freshness.ageDays} ${dayWord} ago.`;
}

export type IncidentRateBasis = {
  /** Resident-days the rate was divided by, when one could be established. */
  residentDays: number | null;
  /** True when the figure may be displayed as a rate. */
  usable: boolean;
  /**
   * True while any day of the window is still projected from a single day's
   * census rather than counted. It goes false only once every day in the window
   * has a recorded census from every facility in scope.
   */
  estimated: boolean;
  /** Days of the window whose census was recorded by every facility in scope. */
  measuredDays: number;
  /** Days the window spans. */
  windowDays: number;
  /** Short qualifier shown beside the figure. */
  line: string;
  /** The arithmetic and its limits, for a disclosure beside the figure. */
  detail: string;
};

/**
 * Resident-days that were counted rather than projected, as summarised by
 * `src/lib/executive/resident-days.ts` from `census_daily_log`.
 *
 * Declared here, where the denominator is interpreted, so the evidence module
 * does not have to depend on the module that reads the table.
 */
export type MeasuredResidentDays = {
  /** Days every facility in scope recorded a census for. */
  measuredDays: number;
  /** Days the window spans. */
  windowDays: number;
  /** Resident-days summed over the measured days only. */
  residentDays: number;
  startDate: string;
  endDate: string;
};

const NO_DENOMINATOR_LINE =
  "No resident-day count is recorded with this figure, so the rate cannot be read.";

const NO_RESIDENTS_LINE =
  "No residents in census over the window — there is no denominator, so no rate.";

function unusableBasis(line: string, windowDays: number, measuredDays: number, residentDays: number | null): IncidentRateBasis {
  return {
    residentDays,
    usable: false,
    estimated: false,
    measuredDays,
    windowDays,
    line,
    detail: line,
  };
}

/**
 * A rate with no denominator is not zero. This returns the denominator behind
 * the figure, and says how much of it was counted rather than assumed.
 *
 * Three outcomes, kept apart because they mean different things to a reader:
 *
 *   * every day of the window has a recorded census from every facility in
 *     scope — the resident-days were served, not estimated, and the qualifier
 *     drops;
 *   * some days are recorded — those are added up and only the remaining days
 *     are projected from the run's census, which is closer than projecting all
 *     thirty but is still an estimate and still says so;
 *   * none are recorded — the original projection, labelled as one.
 *
 * "Estimated" comes off for the portfolio only when nothing in the denominator
 * is assumed. A day one facility missed keeps it on.
 */
export function incidentRateBasis(
  state: ExecutiveSnapshotState,
  measured?: MeasuredResidentDays | null,
): IncidentRateBasis {
  const windowDays = measured?.windowDays ?? INCIDENT_RATE_WINDOW_DAYS;
  const measuredDays = Math.min(measured?.measuredDays ?? 0, windowDays);
  const measuredResidentDays = measured?.residentDays ?? 0;

  if (state.kind !== "recorded") {
    return unusableBasis(NO_DENOMINATOR_LINE, windowDays, 0, null);
  }

  // Fully counted: the run's own one-day census is not consulted at all.
  if (measured && measuredDays >= windowDays && windowDays > 0) {
    if (measuredResidentDays <= 0) {
      // A counted zero, not a missing one — nobody was in census on any of
      // these days, so there is still no rate to show.
      return unusableBasis(NO_RESIDENTS_LINE, windowDays, measuredDays, 0);
    }
    return {
      residentDays: measuredResidentDays,
      usable: true,
      estimated: false,
      measuredDays,
      windowDays,
      line: `Incidents in the trailing ${windowDays} days per 1,000 resident-days.`,
      detail:
        `${measuredResidentDays.toLocaleString()} resident-days is the daily census recorded at ` +
        `every facility in scope, added up across all ${windowDays} days from ${measured.startDate} ` +
        `through ${measured.endDate}. No day in the window is projected.`,
    };
  }

  const residents = state.evidence.occupiedResidents;
  if (residents == null) {
    // Nothing to project the unrecorded days from, so no denominator can be
    // established for them — and a partial one would understate the exposure.
    return unusableBasis(NO_DENOMINATOR_LINE, windowDays, measuredDays, null);
  }

  const projectedDays = Math.max(0, windowDays - measuredDays);
  const projectedResidentDays = residents * projectedDays;
  const residentDays = measuredResidentDays + projectedResidentDays;
  if (residentDays <= 0) {
    return unusableBasis(NO_RESIDENTS_LINE, windowDays, measuredDays, 0);
  }

  const line = `Estimated · incidents in the trailing ${windowDays} days per 1,000 resident-days.`;
  const dayWord = projectedDays === 1 ? "day" : "days";

  if (measured && measuredDays > 0) {
    return {
      residentDays,
      usable: true,
      estimated: true,
      measuredDays,
      windowDays,
      line,
      detail:
        `${residentDays.toLocaleString()} resident-days is ${measuredResidentDays.toLocaleString()} ` +
        `counted from the daily census on ${measuredDays} of the ${windowDays} days, plus ` +
        `${projectedResidentDays.toLocaleString()} projected from ${residents} residents in census on ` +
        `${state.evidence.snapshotDate} for the ${projectedDays} ${dayWord} no census is recorded for. ` +
        `It stays an estimate until every day in the window is recorded at every facility in scope.`,
    };
  }

  return {
    residentDays,
    usable: true,
    estimated: true,
    measuredDays,
    windowDays,
    line,
    detail:
      `${residentDays.toLocaleString()} resident-days is ${residents} residents in census on ` +
      `${state.evidence.snapshotDate} × ${windowDays} days. Daily census across the ` +
      `window is not recorded, so this projects one day's census over the window rather than ` +
      `counting the resident-days actually served.`,
  };
}

/** The dates billed revenue covers, or null when no run dates the figure. */
export function billedRevenuePeriod(state: ExecutiveSnapshotState): string | null {
  if (state.kind !== "recorded") return null;
  const monthStart = `${state.evidence.snapshotDate.slice(0, 7)}-01`;
  return `${monthStart} through ${state.evidence.snapshotDate}`;
}

/** Billed revenue period — named so "$0" is read against a period, not in the air. */
export function billedRevenuePeriodLine(state: ExecutiveSnapshotState): string {
  const period = billedRevenuePeriod(state);
  if (!period) return "No billing period is recorded with this figure.";
  return `Invoices dated ${period}.`;
}

/**
 * What the billed total counts, so a portfolio-wide zero is read as "nothing
 * was issued" rather than "billing was not looked at". Issued invoices only:
 * drafts and voided invoices are outside the figure by design.
 */
export const BILLED_REVENUE_SCOPE_LINE =
  "Counts issued invoices at every facility in scope. Draft and voided invoices are not included.";
