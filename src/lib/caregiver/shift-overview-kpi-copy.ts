import { emptyRosterCopy } from "@/lib/residents/empty-roster-copy";

/**
 * Quiet Operator copy for caregiver shift overview hero stats.
 * Copy reflects real shift-brief counts — never fabricates residents, alerts, meds, or notes.
 */

export type CaregiverShiftOverviewMetrics = {
  census: number;
  urgentAlerts: number;
  medicationsDue: number;
  notesToFinish: number;
};

export type CaregiverShiftOverviewEmptyNotice = {
  title: string;
  helper: string;
};

const HERO_STAT_TOTAL = 4;

/** Whether every hero lane loaded at zero — no assigned work on this shift yet. */
export function caregiverShiftBoardIsEmpty(metrics: CaregiverShiftOverviewMetrics): boolean {
  return (
    metrics.census === 0 &&
    metrics.urgentAlerts === 0 &&
    metrics.medicationsDue === 0 &&
    metrics.notesToFinish === 0
  );
}

/** Calm loading copy for the caregiver home shift brief. */
export function caregiverShiftOverviewLoadingCopy(): string {
  return "Loading this shift…";
}

/** One-line load failure copy — retry stays available in the UI. */
export function caregiverShiftOverviewLoadErrorCopy(): string {
  return "Could not load this shift. Try again.";
}

/** Retry button label for a failed shift brief load. */
export function caregiverShiftOverviewLoadErrorRetryLabel(): string {
  return "Try again";
}

/**
 * Title + helper when the whole shift board is empty after a successful load.
 * A facility with nobody on the roster says so (COL-670): asking a nurse about
 * an assignment cannot help when the building has no residents in Haven.
 */
export function caregiverShiftOverviewEmptyNotice(
  metrics?: CaregiverShiftOverviewMetrics,
  facilityName?: string | null,
): CaregiverShiftOverviewEmptyNotice {
  if (metrics && metrics.census === 0) {
    return {
      title: emptyRosterCopy(facilityName),
      helper: "An administrator adds residents to the roster. Until then rounds, meds and reports have no one to show.",
    };
  }
  return {
    title: "No assigned work on this shift yet",
    helper:
      "Ask a nurse or admin if residents should be on your list. Rounds and meds stay empty until they are.",
  };
}

/** Summary line under the hero stat strip — empty board vs loaded real zeros. */
export function caregiverShiftOverviewKpiStripHelperLine(
  metrics: CaregiverShiftOverviewMetrics,
  facilityName?: string | null,
): string {
  if (caregiverShiftBoardIsEmpty(metrics)) {
    return caregiverShiftOverviewEmptyNotice(metrics, facilityName).helper;
  }

  const zeroLanes = [
    metrics.census === 0,
    metrics.urgentAlerts === 0,
    metrics.medicationsDue === 0,
    metrics.notesToFinish === 0,
  ].filter(Boolean).length;

  if (zeroLanes === 0) {
    return "Shift overview loaded for this shift.";
  }

  return "Shift counts loaded — zeros mean nothing is due in that lane right now.";
}

/** Count of hero lanes with a loaded numeric value (including real zeros when work exists elsewhere). */
export function caregiverShiftOverviewLoadedLaneCount(
  metrics: CaregiverShiftOverviewMetrics,
): number {
  if (caregiverShiftBoardIsEmpty(metrics)) {
    return 0;
  }
  return HERO_STAT_TOTAL;
}
