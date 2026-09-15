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
 * `not_reported` means none did — the measure is absent, not zero.
 * `past` means the measure exists but describes an earlier day.
 * `unreadable` means the read itself failed — coverage is unknown.
 */

import type { OccupancyContext } from "@/lib/executive/kpi-tile-copy";
import { incidentRateBasis, type ExecutiveSnapshotState } from "@/lib/executive/snapshot-evidence";

export type CoverageState = "reported" | "partial" | "not_reported" | "past" | "unreadable";

export type CoverageMeasureKey = "census" | "payroll" | "survey" | "incidents" | "rounding";

export type CoverageRow = {
  key: CoverageMeasureKey;
  /** Owner-facing name of the measure. */
  label: string;
  state: CoverageState;
  /** What is and is not covered, in one line. */
  detail: string;
};

export type CoverageInput = {
  facilityCount: number;
  occupancy: OccupancyContext | null;
  /** Portfolio metric map as displayed — a key is present only when a value exists. */
  metrics: Record<string, number | undefined>;
  snapshot: ExecutiveSnapshotState;
  /** Facilities with at least one recorded assurance observation. */
  observedFacilityCount: number;
};

const NOT_REPORTED_DETAIL: Record<CoverageMeasureKey, string> = {
  census: "No facility has posted a bed census.",
  payroll: "No payroll hours have been loaded for this period.",
  survey: "No survey readiness review is on file.",
  incidents: "No incident rate has been recorded.",
  rounding: "No rounding observations have been recorded.",
};

function facilityWord(count: number): string {
  return count === 1 ? "facility" : "facilities";
}

function censusRow(input: CoverageInput): CoverageRow {
  const total = input.occupancy?.totalFacilityCount ?? input.facilityCount;
  const posted = input.occupancy?.postedFacilityCount ?? 0;

  if (posted === 0) {
    return { key: "census", label: "Census", state: "not_reported", detail: NOT_REPORTED_DETAIL.census };
  }
  if (posted < total) {
    return {
      key: "census",
      label: "Census",
      state: "partial",
      detail: `${posted} of ${total} ${facilityWord(total)} posted. Occupancy covers those ${posted} only.`,
    };
  }
  return {
    key: "census",
    label: "Census",
    state: "reported",
    detail: `All ${total} ${facilityWord(total)} posted.`,
  };
}

function snapshotBackedRow(
  key: Exclude<CoverageMeasureKey, "census" | "rounding">,
  label: string,
  input: CoverageInput,
  metricKey: string,
): CoverageRow {
  if (input.snapshot.kind === "unreadable") {
    return { key, label, state: "unreadable", detail: "The recorded figures could not be read." };
  }
  if (input.metrics[metricKey] === undefined) {
    return { key, label, state: "not_reported", detail: NOT_REPORTED_DETAIL[key] };
  }
  if (input.snapshot.kind === "recorded" && input.snapshot.stale) {
    const dayWord = input.snapshot.ageDays === 1 ? "day" : "days";
    return {
      key,
      label,
      state: "past",
      detail: `Recorded ${input.snapshot.evidence.snapshotDate}, ${input.snapshot.ageDays} ${dayWord} ago.`,
    };
  }
  return { key, label, state: "reported", detail: "Recorded in the latest run." };
}

function roundingRow(input: CoverageInput): CoverageRow {
  const total = input.facilityCount;
  const observed = input.observedFacilityCount;

  if (total === 0 || observed === 0) {
    return { key: "rounding", label: "Rounding", state: "not_reported", detail: NOT_REPORTED_DETAIL.rounding };
  }
  if (observed < total) {
    return {
      key: "rounding",
      label: "Rounding",
      state: "partial",
      detail: `Observations recorded at ${observed} of ${total} ${facilityWord(total)}.`,
    };
  }
  return {
    key: "rounding",
    label: "Rounding",
    state: "reported",
    detail: `Observations recorded at all ${total} ${facilityWord(total)}.`,
  };
}

/**
 * The incident rate needs both a count and a denominator. A count recorded
 * against no resident-days is not a rate, and the tile withholds it, so
 * coverage must not claim the measure is reported.
 */
function incidentRow(input: CoverageInput): CoverageRow {
  const row = snapshotBackedRow("incidents", "Incident rate", input, "inc_rate");
  if (row.state === "not_reported" || row.state === "unreadable") return row;
  if (incidentRateBasis(input.snapshot).usable) return row;
  return {
    ...row,
    state: "not_reported",
    detail: "An incident count exists but no resident-day denominator was recorded, so there is no rate.",
  };
}

/** One row per measure an owner reads on this page, in the order they appear. */
export function buildExecutiveCoverage(input: CoverageInput): CoverageRow[] {
  return [
    censusRow(input),
    snapshotBackedRow("payroll", "Payroll", input, "labor_pct"),
    snapshotBackedRow("survey", "Survey readiness", input, "survey_rd"),
    incidentRow(input),
    roundingRow(input),
  ];
}

export function isCoverageGap(row: CoverageRow): boolean {
  return row.state !== "reported";
}

/** Replaces a retrieval count ("3 of 5 loaded") with what the owner can rely on. */
export function coverageSummaryLine(rows: CoverageRow[]): string {
  const total = rows.length;
  const reported = rows.filter((row) => row.state === "reported").length;

  if (reported === total) {
    return `All ${total} measures are reported across every facility in scope.`;
  }
  if (reported === 0) {
    return `None of the ${total} measures is fully reported — each line below says what is missing.`;
  }
  return `${reported} of ${total} measures are fully reported — the rest say what is missing.`;
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
        : `This covers recorded alerts only. ${gaps} ${gaps === 1 ? "measure is" : "measures are"} not fully reported — see monitoring coverage.`,
  };
}
