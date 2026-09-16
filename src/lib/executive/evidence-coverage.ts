/**
 * Evidence coverage for the executive overview.
 *
 * The overview's hardest question is not "what are the numbers" but "how much
 * of the portfolio is actually being observed". A zero from five reporting
 * facilities and a zero from none of them look identical on a tile; this model
 * keeps them apart and names the difference in operator language.
 *
 * `reported` means every in-scope facility supplied the measure.
 * `partial` means some did.
 * `estimated` means a figure is shown but rests on a projection, not a count.
 * `not_reported` means none did — the measure is absent, not zero.
 * `past` means the measure exists but describes an earlier day.
 * `unreadable` means coverage is unknown — the read failed, or the figure
 * arrived without the run record that would date and explain it.
 *
 * A successful read is never treated as complete reporting: each state below is
 * derived from what the run actually counted, not from the query returning.
 */

import type { OccupancyContext } from "@/lib/executive/kpi-tile-copy";
import {
  billedRevenuePeriod,
  incidentRateBasis,
  INCIDENT_RATE_WINDOW_DAYS,
  type ExecutiveSnapshotState,
} from "@/lib/executive/snapshot-evidence";

export type CoverageState =
  | "reported"
  | "partial"
  | "estimated"
  | "not_reported"
  | "past"
  | "unreadable";

export type CoverageMeasureKey =
  | "census"
  | "billing"
  | "payroll"
  | "survey"
  | "incidents"
  | "rounding";

/** The work a gap implies, pointed at a destination that already exists. */
export type CoverageFollowUp = {
  /** One line an owner can act on, without reading the coverage detail. */
  summary: string;
  actionLabel: string;
  href: string;
};

export type CoverageRow = {
  key: CoverageMeasureKey;
  /** Owner-facing name of the measure. */
  label: string;
  state: CoverageState;
  /** Two or three words for the compact coverage strip. */
  short: string;
  /** What is and is not covered, in one line. */
  detail: string;
  followUp?: CoverageFollowUp;
};

export type CoverageInput = {
  facilityCount: number;
  occupancy: OccupancyContext | null;
  /** Portfolio metric map as displayed — a key is present only when a value exists. */
  metrics: Record<string, number | undefined>;
  snapshot: ExecutiveSnapshotState;
  /** Facilities with at least one recorded assurance observation. */
  observedFacilityCount: number;
  /** Facilities carrying a recorded survey readiness review of their own. */
  surveyFacilityCount: number;
};

const UNREADABLE_DETAIL = "The recorded figures could not be read.";
const UNDATED_DETAIL =
  "A figure is on file but the run that produced it is not, so its age and basis are unknown.";

function facilityWord(count: number): string {
  return count === 1 ? "facility" : "facilities";
}

function pastRow(
  key: CoverageMeasureKey,
  label: string,
  snapshotDate: string,
  ageDays: number,
): CoverageRow {
  return {
    key,
    label,
    state: "past",
    short: "Earlier day",
    detail: `Recorded ${snapshotDate}, ${ageDays} ${ageDays === 1 ? "day" : "days"} ago.`,
  };
}

function censusRow(input: CoverageInput): CoverageRow {
  const total = input.occupancy?.totalFacilityCount ?? input.facilityCount;
  const posted = input.occupancy?.postedFacilityCount ?? 0;
  const missing = Math.max(0, total - posted);
  const review = {
    actionLabel: "Review facilities",
    href: "/admin/facilities",
  };

  if (posted === 0) {
    return {
      key: "census",
      label: "Census",
      state: "not_reported",
      short: "None posted",
      detail: "No facility has posted a bed census.",
      followUp: { summary: "No facility has posted a bed census", ...review },
    };
  }
  if (posted < total) {
    return {
      key: "census",
      label: "Census",
      state: "partial",
      short: `${posted} of ${total}`,
      detail: `${posted} of ${total} ${facilityWord(total)} posted. Occupancy covers those ${posted} only.`,
      followUp: {
        summary: `Census missing at ${missing} ${facilityWord(missing)}`,
        ...review,
      },
    };
  }
  return {
    key: "census",
    label: "Census",
    state: "reported",
    short: `${total} of ${total}`,
    detail: `All ${total} ${facilityWord(total)} posted.`,
  };
}

/**
 * Billed revenue is read across every facility in scope for a dated period, so
 * its coverage question is not "who reported" but "what period, and what counts".
 * A portfolio-wide zero is only shown against that statement.
 */
function billingRow(input: CoverageInput): CoverageRow {
  const label = "Billing";
  if (input.snapshot.kind === "unreadable") {
    return { key: "billing", label, state: "unreadable", short: "Unknown", detail: UNREADABLE_DETAIL };
  }

  const billed = input.metrics.rev_mtd;
  if (billed === undefined) {
    return {
      key: "billing",
      label,
      state: "not_reported",
      short: "Unavailable",
      detail: "No billed total has been recorded for this period.",
      followUp: {
        summary: "No billed total recorded for this period",
        actionLabel: "Open billing",
        href: "/admin/billing",
      },
    };
  }
  if (input.snapshot.kind !== "recorded") {
    return { key: "billing", label, state: "unreadable", short: "Undated", detail: UNDATED_DETAIL };
  }
  if (input.snapshot.stale) {
    return pastRow("billing", label, input.snapshot.evidence.snapshotDate, input.snapshot.ageDays);
  }

  // The exclusions are stated beside the figure itself; this row answers the
  // coverage question — which facilities were read, and over what period.
  const scope = `Every facility in scope was read for ${billedRevenuePeriod(input.snapshot)}.`;
  if (billed === 0) {
    return {
      key: "billing",
      label,
      state: "reported",
      short: "Nothing issued",
      detail: `${scope} Nothing was issued, so the total is a true zero rather than a missing figure.`,
      followUp: {
        summary: "Nothing billed so far this period",
        actionLabel: "Open billing",
        href: "/admin/billing",
      },
    };
  }
  return {
    key: "billing",
    label,
    state: "reported",
    short: "Recorded",
    detail: scope,
  };
}

/**
 * Labor cost is a ratio, and it can go missing for two different reasons. The
 * run records the payroll cost separately from the percentage, so an absent
 * percentage with a recorded payroll cost is a billing gap, not a payroll one —
 * the page must not assert the wrong cause.
 */
function payrollRow(input: CoverageInput): CoverageRow {
  const label = "Labor cost %";
  if (input.snapshot.kind === "unreadable") {
    return { key: "payroll", label, state: "unreadable", short: "Unknown", detail: UNREADABLE_DETAIL };
  }

  if (input.metrics.labor_pct === undefined) {
    if (input.snapshot.kind === "recorded") {
      const { laborCostMtdCents, billedRevenueMtdCents } = input.snapshot.evidence;
      if (laborCostMtdCents == null) {
        return {
          key: "payroll",
          label,
          state: "not_reported",
          short: "No payroll",
          detail: "No payroll hours have been loaded for this period.",
          followUp: {
            summary: "Payroll hours not loaded for this period",
            actionLabel: "Open payroll",
            href: "/admin/payroll",
          },
        };
      }
      if (billedRevenueMtdCents === 0) {
        return {
          key: "payroll",
          label,
          state: "not_reported",
          short: "No basis",
          detail:
            "Payroll hours are loaded, but nothing was billed this period, so labor cost has no revenue to be a percentage of.",
          followUp: {
            summary: "Labor cost has no billed revenue to measure against",
            actionLabel: "Open billing",
            href: "/admin/billing",
          },
        };
      }
    }
    return {
      key: "payroll",
      label,
      state: "not_reported",
      short: "Unavailable",
      detail: "No labor cost percentage has been recorded for this period.",
      followUp: {
        summary: "Labor cost percentage not recorded",
        actionLabel: "Open payroll",
        href: "/admin/payroll",
      },
    };
  }

  if (input.snapshot.kind !== "recorded") {
    return { key: "payroll", label, state: "unreadable", short: "Undated", detail: UNDATED_DETAIL };
  }
  if (input.snapshot.stale) {
    return pastRow("payroll", label, input.snapshot.evidence.snapshotDate, input.snapshot.ageDays);
  }
  return {
    key: "payroll",
    label,
    state: "reported",
    short: "Recorded",
    detail: "Payroll cost for the period divided by billed revenue for the same period.",
  };
}

/**
 * Survey readiness averages the most recent review at each facility that has
 * one, so the portfolio figure only speaks for the facilities holding a review.
 * The per-facility readings on this page say how many that is.
 */
function surveyRow(input: CoverageInput): CoverageRow {
  const label = "Survey readiness";
  const openRisk = { actionLabel: "Open risk command", href: "/admin/risk" };

  if (input.snapshot.kind === "unreadable") {
    return { key: "survey", label, state: "unreadable", short: "Unknown", detail: UNREADABLE_DETAIL };
  }
  if (input.metrics.survey_rd === undefined) {
    return {
      key: "survey",
      label,
      state: "not_reported",
      short: "Unavailable",
      detail: "No survey readiness review is on file.",
      followUp: { summary: "No survey readiness review on file", ...openRisk },
    };
  }
  if (input.snapshot.kind !== "recorded") {
    return { key: "survey", label, state: "unreadable", short: "Undated", detail: UNDATED_DETAIL };
  }
  if (input.snapshot.stale) {
    return pastRow("survey", label, input.snapshot.evidence.snapshotDate, input.snapshot.ageDays);
  }

  const total = input.facilityCount;
  const reviewed = input.surveyFacilityCount;
  if (total === 0 || reviewed === 0) {
    return {
      key: "survey",
      label,
      state: "partial",
      short: "Sites unknown",
      detail:
        "A portfolio readiness average is recorded, but no facility on this page carries a readiness review of its own.",
      followUp: { summary: "Readiness average covers an unknown set of facilities", ...openRisk },
    };
  }
  if (reviewed < total) {
    const missing = total - reviewed;
    return {
      key: "survey",
      label,
      state: "partial",
      short: `${reviewed} of ${total}`,
      detail: `Readiness review on file at ${reviewed} of ${total} ${facilityWord(total)}. The average covers those ${reviewed} only.`,
      followUp: {
        summary: `Survey readiness missing at ${missing} ${facilityWord(missing)}`,
        ...openRisk,
      },
    };
  }
  return {
    key: "survey",
    label,
    state: "reported",
    short: `${total} of ${total}`,
    detail: `Readiness review on file at all ${total} ${facilityWord(total)}.`,
  };
}

function roundingRow(input: CoverageInput): CoverageRow {
  const total = input.facilityCount;
  const observed = input.observedFacilityCount;
  const open = {
    actionLabel: "Open Smart Rounding",
    href: "/admin/rounding",
  };

  if (total === 0 || observed === 0) {
    return {
      key: "rounding",
      label: "Rounding",
      state: "not_reported",
      short: "None recorded",
      detail: "No rounding observations have been recorded.",
      followUp: { summary: "No rounding observations recorded", ...open },
    };
  }
  if (observed < total) {
    const missing = total - observed;
    return {
      key: "rounding",
      label: "Rounding",
      state: "partial",
      short: `${observed} of ${total}`,
      detail: `Observations recorded at ${observed} of ${total} ${facilityWord(total)}.`,
      followUp: {
        summary: `Rounding missing at ${missing} ${facilityWord(missing)}`,
        ...open,
      },
    };
  }
  return {
    key: "rounding",
    label: "Rounding",
    state: "reported",
    short: `${total} of ${total}`,
    detail: `Observations recorded at all ${total} ${facilityWord(total)}.`,
  };
}

/**
 * The incident rate needs both a count and a denominator. A count recorded
 * against no resident-days is not a rate, and the tile withholds it, so
 * coverage must not claim the measure is reported. Where a denominator does
 * exist it is projected from one day's census, so the measure is reported as
 * estimated rather than as an established rate.
 */
function incidentRow(input: CoverageInput): CoverageRow {
  const label = "Incident rate";
  if (input.snapshot.kind === "unreadable") {
    return { key: "incidents", label, state: "unreadable", short: "Unknown", detail: UNREADABLE_DETAIL };
  }
  if (input.metrics.inc_rate === undefined) {
    return {
      key: "incidents",
      label,
      state: "not_reported",
      short: "Unavailable",
      detail: "No incident rate has been recorded.",
      followUp: {
        summary: "No incident rate recorded",
        actionLabel: "Open incident queue",
        href: "/admin/incidents",
      },
    };
  }

  const basis = incidentRateBasis(input.snapshot);
  if (!basis.usable) {
    return {
      key: "incidents",
      label,
      state: "not_reported",
      short: "No denominator",
      detail:
        "An incident count exists but no resident-day denominator was recorded, so there is no rate.",
      followUp: {
        summary: "Incident rate has no resident-day denominator",
        actionLabel: "Open incident queue",
        href: "/admin/incidents",
      },
    };
  }
  if (input.snapshot.kind === "recorded" && input.snapshot.stale) {
    return pastRow("incidents", label, input.snapshot.evidence.snapshotDate, input.snapshot.ageDays);
  }
  // The arithmetic itself belongs beside the figure, not here as well.
  return {
    key: "incidents",
    label,
    state: "estimated",
    short: "Estimated",
    detail: `Counted across every facility in scope for the trailing ${INCIDENT_RATE_WINDOW_DAYS} days. The resident-day denominator is projected from one day's census, so the rate is an estimate.`,
  };
}

/** One row per measure an owner reads on this page, in the order they appear. */
export function buildExecutiveCoverage(input: CoverageInput): CoverageRow[] {
  return [
    censusRow(input),
    billingRow(input),
    payrollRow(input),
    surveyRow(input),
    incidentRow(input),
    roundingRow(input),
  ];
}

/**
 * A gap is information that never arrived. An estimated figure did arrive and
 * is labelled as an estimate where it is shown, so it is not counted here.
 */
export function isCoverageGap(row: CoverageRow): boolean {
  return row.state !== "reported" && row.state !== "estimated";
}

/** Rows an owner can do something about, each with a destination that exists. */
export function coverageFollowUps(rows: CoverageRow[]): Array<CoverageRow & { followUp: CoverageFollowUp }> {
  return rows.filter(
    (row): row is CoverageRow & { followUp: CoverageFollowUp } => row.followUp !== undefined,
  );
}

/** Three words at the head of the coverage strip. Never an all-clear by default. */
export function coverageHeadline(rows: CoverageRow[]): string {
  if (rows.some((row) => row.state === "unreadable")) return "Coverage partly unknown";
  return rows.some(isCoverageGap) ? "Coverage incomplete" : "Coverage complete";
}

/** Replaces a retrieval count ("3 of 5 loaded") with what the owner can rely on. */
export function coverageSummaryLine(rows: CoverageRow[]): string {
  const total = rows.length;
  const reported = rows.filter((row) => row.state === "reported").length;

  if (reported === total) {
    return `All ${total} measures are reported across every facility in scope.`;
  }
  if (reported === 0) {
    return `None of the ${total} measures is fully reported.`;
  }
  return `${reported} of ${total} measures are fully reported.`;
}

/**
 * Missing information is work, but it is not a clinical or operational
 * exception. It is listed separately from the watchlist for that reason.
 */
export function coverageGapLine(rows: CoverageRow[]): string {
  const gaps = rows.filter(isCoverageGap);
  if (gaps.length === 0) return "Every measure on this page is reported.";
  return `${gaps.length} ${gaps.length === 1 ? "measure is" : "measures are"} incomplete. Missing information is not the same as an all-clear.`;
}

/**
 * The watchlist can only speak for the records it queried. This is the line it
 * uses instead of asserting that nothing needs attention.
 */
export function noAlertsCopy(rows: CoverageRow[]): { headline: string; body: string } {
  const gaps = rows.filter(isCoverageGap).length;
  return {
    headline: "No critical alerts recorded in the available data.",
    body:
      gaps === 0
        ? "Every measure on this page is reported, so this reflects the full portfolio."
        : `Recorded alerts only — ${gaps} of ${rows.length} measures are not fully reported.`,
  };
}
