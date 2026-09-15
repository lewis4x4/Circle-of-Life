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

export type IncidentRateBasis = {
  /** Resident-days the rate was divided by, when the run recorded a census. */
  residentDays: number | null;
  /** True when the figure may be displayed as a rate. */
  usable: boolean;
  line: string;
};

/**
 * A rate with no denominator is not zero. This returns the denominator the run
 * used, or says plainly that there isn't one.
 */
export function incidentRateBasis(state: ExecutiveSnapshotState): IncidentRateBasis {
  if (state.kind !== "recorded") {
    return {
      residentDays: null,
      usable: false,
      line: "No resident-day count is recorded with this figure, so the rate cannot be read.",
    };
  }

  const residents = state.evidence.occupiedResidents;
  if (residents == null) {
    return {
      residentDays: null,
      usable: false,
      line: "No resident-day count is recorded with this figure, so the rate cannot be read.",
    };
  }
  if (residents <= 0) {
    return {
      residentDays: 0,
      usable: false,
      line: "No residents in census over the window — there is no denominator, so no rate.",
    };
  }

  const residentDays = residents * INCIDENT_RATE_WINDOW_DAYS;
  return {
    residentDays,
    usable: true,
    line: `Per 1,000 resident-days · trailing ${INCIDENT_RATE_WINDOW_DAYS} days · ${residentDays.toLocaleString()} resident-days (${residents} residents × ${INCIDENT_RATE_WINDOW_DAYS} days).`,
  };
}

/** Billed revenue period — named so "$0" is read against a period, not in the air. */
export function billedRevenuePeriodLine(state: ExecutiveSnapshotState): string {
  if (state.kind !== "recorded") {
    return "No billing period is recorded with this figure.";
  }
  const monthStart = `${state.evidence.snapshotDate.slice(0, 7)}-01`;
  return `Invoices dated ${monthStart} through ${state.evidence.snapshotDate}.`;
}
