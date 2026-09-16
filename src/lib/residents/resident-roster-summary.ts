/**
 * Resident roster summary strip — facility-wide figures computed from the
 * complete scoped roster (every resident the query returned for the selected
 * facility), never from the filtered rows on screen.
 *
 * Each figure states what the records establish and what they do not:
 * a count of documented high-acuity residents is only meaningful next to the
 * number of residents whose acuity has been posted at all.
 */

import type { ResidentRow } from "./load-residents";
import type { CarePlanCoverage, ResidentRosterMetrics } from "./resident-roster-metrics";

export type ResidentRosterGroupBy = "unit" | "acuity" | "status" | "none";

export type AcuityCoverage = {
  /** Residents in the scoped roster. */
  total: number;
  /** Residents with a posted acuity level. */
  assessed: number;
  /** Residents with a posted acuity level of 3. */
  highAcuity: number;
};

function acuityPosted(row: ResidentRow): boolean {
  return row.acuityLevel != null && row.acuityLevel.trim().length > 0;
}

export function acuityCoverage(rows: ResidentRow[]): AcuityCoverage {
  let assessed = 0;
  let highAcuity = 0;
  for (const row of rows) {
    if (!acuityPosted(row)) continue;
    assessed += 1;
    if (row.acuity >= 3) highAcuity += 1;
  }
  return { total: rows.length, assessed, highAcuity };
}

export type SummaryFigure = {
  /** The dominant line. A number when the records establish one; otherwise the honest state. */
  headline: string;
  /** What the headline is made of, or why there is no number. */
  detail: string;
  tone: "neutral" | "warning" | "danger";
};

export const HIGH_ACUITY_NOT_ESTABLISHED = "Not established";

/** High acuity paired with assessment coverage — a zero with no assessments is not a zero. */
export function highAcuityFigure(coverage: AcuityCoverage): SummaryFigure {
  const { total, assessed, highAcuity } = coverage;
  const notPosted = total - assessed;
  if (total === 0) {
    return { headline: HIGH_ACUITY_NOT_ESTABLISHED, detail: "No residents in scope", tone: "neutral" };
  }
  if (assessed === 0) {
    return {
      headline: HIGH_ACUITY_NOT_ESTABLISHED,
      detail: `Acuity posted for 0 of ${total} residents`,
      tone: "neutral",
    };
  }
  const detail =
    notPosted > 0
      ? `Acuity posted for ${assessed} of ${total} · ${notPosted} not posted`
      : `Acuity posted for all ${total} residents`;
  return {
    headline: `${highAcuity} of ${assessed} assessed`,
    detail,
    tone: highAcuity >= 4 ? "danger" : highAcuity >= 1 ? "warning" : "neutral",
  };
}

export type PresenceBreakdown = {
  total: number;
  inHouse: number;
  hospital: number;
  onLeave: number;
};

export function presenceBreakdown(rows: ResidentRow[]): PresenceBreakdown {
  return {
    total: rows.length,
    inHouse: rows.filter((row) => row.status === "active").length,
    hospital: rows.filter((row) => row.status === "hospital").length,
    onLeave: rows.filter((row) => row.status === "loa").length,
  };
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** "25 residents · 25 in-house · 0 hospital · 0 on leave" — facility-wide, not filtered. */
export function presenceLine(breakdown: PresenceBreakdown): string {
  return `${plural(breakdown.total, "resident")} · ${breakdown.inHouse} in-house · ${breakdown.hospital} hospital · ${breakdown.onLeave} on leave`;
}

/** Row count beside the table. States the filtered population against the facility total. */
export function rosterShowingCopy(shown: number, total: number): string {
  if (total === 0) return "Showing 0 residents";
  if (shown === total) return `Showing all ${plural(total, "resident")}`;
  return `Showing ${shown} of ${plural(total, "resident")}`;
}

/**
 * Licensed capacity minus census is arithmetic, not an admission promise:
 * held, blocked, and restricted beds are not subtracted here.
 */
export function unoccupiedBedsFigure(metrics: ResidentRosterMetrics | null): SummaryFigure | null {
  if (metrics == null || metrics.licensedBeds == null || metrics.openBeds == null) return null;
  return {
    headline: String(metrics.openBeds),
    detail: `${metrics.occupiedResidents} in census · ${metrics.licensedBeds} licensed · holds and blocked beds not subtracted`,
    tone: "neutral",
  };
}

export const UNOCCUPIED_BEDS_LABEL = "Unoccupied licensed beds";

/**
 * Care plan figure. "0 reviews due" can be true while residents have no plan
 * at all, so the figure always states the plan gap beside the review count.
 */
export function carePlanFigure(coverage: CarePlanCoverage | null): SummaryFigure | null {
  if (coverage == null) return null;
  const parts: string[] = [];
  if (coverage.reviewsOverdue > 0) parts.push(`${coverage.reviewsOverdue} overdue`);
  parts.push(`${coverage.residentsWithoutActivePlan} without an active plan`);
  if (coverage.plansWithoutReviewDate > 0) {
    parts.push(`${coverage.plansWithoutReviewDate} ${coverage.plansWithoutReviewDate === 1 ? "plan" : "plans"} without a review date`);
  }
  const gapTone: SummaryFigure["tone"] =
    coverage.reviewsOverdue > 0 || coverage.residentsWithoutActivePlan > 0 ? "warning" : "neutral";
  return {
    headline: String(coverage.reviewsDueWeek),
    detail: parts.join(" · "),
    tone: coverage.reviewsDueWeek > 0 ? "warning" : gapTone,
  };
}

export const CARE_PLAN_REVIEWS_LABEL = "Care plan reviews due (7 days)";

/**
 * Grouping by a field that no resident carries adds a container and an awkward
 * summary and nothing else. Fall back to the flat, room-sorted list and say why.
 * Never derive a unit from a room number.
 */
export function effectiveRosterGroupBy(
  requested: ResidentRosterGroupBy,
  rows: ResidentRow[],
): { groupBy: ResidentRosterGroupBy; notice: string | null } {
  if (requested !== "unit") return { groupBy: requested, notice: null };
  const anyUnit = rows.some((row) => row.unit.trim().length > 0);
  if (anyUnit || rows.length === 0) return { groupBy: requested, notice: null };
  return {
    groupBy: "none",
    notice: "No unit assignments on file for this facility — showing the room-sorted list.",
  };
}
