/**
 * Observation compliance, aggregated. Spec 25A sections 7.1 and 6.3, build
 * notes 4b, decision D13.
 *
 * Compliance and on-time rate used to sit on resident rows, blended into a
 * 0-to-100 score. Section 7.1 retired that: observation compliance measures
 * whether *staff* did their job, and putting it on a resident row means a
 * resident reads as declining because their caregiver ran late. So the numbers
 * moved here, to Integrity, cut by shift, hall and staff member.
 *
 * Every number comes from `public.observation_compliance_for_range`. Nothing
 * here counts `resident_observation_tasks`, and that is not a style
 * preference. A resident on a thirty minute Monitoring Order has no standard
 * task rows at all, so counting task rows reports them as missing six windows a
 * day; and a resident day nothing was generated for has no rows either, so
 * counting task rows reports zero over zero, which a dashboard reads as a
 * hundred percent. The function projects the windows the cadence version in
 * force defines, which is the only grain that can speak about a day nobody
 * wrote anything down for.
 *
 * `unconfigured` is carried all the way to the surface and never folded into
 * the rate. Those rows are unsatisfied expectations whose cause is a
 * configuration gap rather than a missed check, and a surface that shows
 * satisfied over expected and hides them has put the dishonesty back at the UI
 * layer.
 */

/** One row of `observation_compliance_for_range`, as the route reads it. */
export type ComplianceRow = {
  resident_id: string;
  service_date: string;
  window_key: string | null;
  shift_key: string | null;
  task_id: string | null;
  task_status: string | null;
  satisfied: boolean;
  absorbed: boolean | null;
  expectation_source: string;
};

export type ComplianceTotals = {
  expected: number;
  satisfied: number;
  /** Windows whose cause is a configuration gap, never rounded into a rate. */
  unconfigured: number;
  /** Standard windows a Monitoring Order check satisfied. */
  absorbed: number;
  /** Windows that had a standard task behind them. The on-time denominator. */
  withTask: number;
  onTime: number;
  late: number;
};

export type ComplianceCut = ComplianceTotals & {
  key: string;
  label: string;
};

export type ComplianceSummary = {
  from: string;
  to: string;
  totals: ComplianceTotals;
  byShift: ComplianceCut[];
  byHall: ComplianceCut[];
  byStaff: ComplianceCut[];
};

export const NO_CADENCE_SOURCE = "no_cadence";

/** Labels for the buckets a row can fall into when its cut has no value. */
export const COMPLIANCE_NO_SHIFT_LABEL = "No cadence in force";
export const COMPLIANCE_NO_HALL_LABEL = "No hall posted";
export const COMPLIANCE_NO_STAFF_LABEL = "No assigned staff";

function emptyTotals(): ComplianceTotals {
  return {
    expected: 0,
    satisfied: 0,
    unconfigured: 0,
    absorbed: 0,
    withTask: 0,
    onTime: 0,
    late: 0,
  };
}

function accumulate(totals: ComplianceTotals, row: ComplianceRow): void {
  totals.expected += 1;
  if (row.satisfied) totals.satisfied += 1;
  if (row.expectation_source === NO_CADENCE_SOURCE) totals.unconfigured += 1;
  if (row.absorbed) totals.absorbed += 1;
  if (row.task_id) {
    totals.withTask += 1;
    if (row.task_status === "completed_on_time") totals.onTime += 1;
    if (row.task_status === "completed_late") totals.late += 1;
  }
}

function cutBy(
  rows: readonly ComplianceRow[],
  resolve: (row: ComplianceRow) => { key: string; label: string },
): ComplianceCut[] {
  const buckets = new Map<string, ComplianceCut>();
  for (const row of rows) {
    const { key, label } = resolve(row);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label, ...emptyTotals() };
      buckets.set(key, bucket);
    }
    accumulate(bucket, row);
  }
  return Array.from(buckets.values()).sort((a, b) => b.expected - a.expected);
}

/**
 * The three cuts spec section 7.1 names. Halls and staff are looked up rather
 * than derived from the compliance rows, because the function answers about
 * resident days and windows and knows nothing about either.
 */
export function summarizeObservationCompliance(args: {
  from: string;
  to: string;
  rows: readonly ComplianceRow[];
  shiftLabels: ReadonlyMap<string, string>;
  hallByResident: ReadonlyMap<string, { key: string; label: string }>;
  staffByTask: ReadonlyMap<string, { key: string; label: string }>;
}): ComplianceSummary {
  const totals = emptyTotals();
  for (const row of args.rows) accumulate(totals, row);

  return {
    from: args.from,
    to: args.to,
    totals,
    byShift: cutBy(args.rows, (row) => {
      if (!row.shift_key) return { key: NO_CADENCE_SOURCE, label: COMPLIANCE_NO_SHIFT_LABEL };
      return {
        key: row.shift_key,
        // A window whose shift has no definition row is a real finding, so it
        // reads as one rather than borrowing a shift name.
        label: args.shiftLabels.get(row.shift_key) ?? "No shift posted",
      };
    }),
    byHall: cutBy(args.rows, (row) => {
      return (
        args.hallByResident.get(row.resident_id) ?? {
          key: "no_hall",
          label: COMPLIANCE_NO_HALL_LABEL,
        }
      );
    }),
    byStaff: cutBy(args.rows, (row) => {
      if (!row.task_id) return { key: "no_task", label: COMPLIANCE_NO_STAFF_LABEL };
      return (
        args.staffByTask.get(row.task_id) ?? {
          key: "no_staff",
          label: COMPLIANCE_NO_STAFF_LABEL,
        }
      );
    }),
  };
}

/** Satisfied over expected. Zero expected is not a hundred percent; it is null. */
export function complianceRate(totals: ComplianceTotals): number | null {
  if (totals.expected === 0) return null;
  return totals.satisfied / totals.expected;
}

/**
 * On time over the windows that had a standard task behind them.
 *
 * The denominator is deliberately not `expected`. A window a Monitoring Order
 * check absorbed has no task and therefore no completion time to be on time
 * against, and a window whose cadence never resolved has no task either.
 * Dividing by `expected` would report those as late work by somebody.
 */
export function onTimeRate(totals: ComplianceTotals): number | null {
  if (totals.withTask === 0) return null;
  return totals.onTime / totals.withTask;
}

/** "84%" or the named gap. Never "0%" for an absent denominator. */
export function formatComplianceRate(rate: number | null): string {
  if (rate == null) return "No data posted";
  return `${Math.round(rate * 100)}%`;
}
