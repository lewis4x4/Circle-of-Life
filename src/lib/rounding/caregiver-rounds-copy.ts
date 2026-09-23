/**
 * Caregiver rounding queue copy. Spec 25A section 8, defect 3 and section 13.
 *
 * Replaces the copy in `col-discovery-round-cadence.ts`, which is gone. That
 * file resolved a facility by *name* against a hardcoded list, held the
 * 2026-08-14 observation times as literals, and named the person whose cadence
 * it was in eight operator-facing strings. All three are now rule violations:
 * facility name matching silently misses the two buildings migration `318`
 * renamed, times are rows, and no named person appears in the product.
 *
 * What survives is the honest part. An empty queue has three distinct causes
 * and a caregiver can act on a different thing in each, so the copy still
 * names which one it is. There is no "cadence pending" state any more: the
 * cadence is configuration and it is in force at every building.
 */

import { metricNotConfigured, metricUnavailable, metricValue, type MetricState } from "@/lib/metrics/metric-state";

export type CaregiverRoundsQueueState =
  | "no_facility"
  | "no_tasks_assigned"
  | "empty_window";

export type CaregiverRoundsEmptyCopy = {
  why: string;
  guidance: string;
};

/**
 * The queue gap, from the rows actually loaded. It never invents a task or a
 * resident, and it no longer asks a facility's name what cadence it is on.
 */
export function deriveCaregiverRoundsQueueState(args: {
  hasFacility: boolean;
  totalTasks: number;
  activeTaskCount: number;
}): CaregiverRoundsQueueState | null {
  if (!args.hasFacility) return "no_facility";
  if (args.totalTasks === 0) return "no_tasks_assigned";
  if (args.activeTaskCount === 0) return "empty_window";
  return null;
}

export function describeCaregiverRoundsEmptyState(
  state: CaregiverRoundsQueueState,
): CaregiverRoundsEmptyCopy {
  switch (state) {
    case "no_facility":
      return {
        why: "No building linked to your account",
        guidance:
          "Ask an administrator to give you access to the building you are working in today.",
      };
    case "no_tasks_assigned":
      return {
        why: "No checks queued for you",
        guidance:
          "Nothing in this queue is assigned to you. Ask your charge nurse who is covering your hall this shift.",
      };
    case "empty_window":
      return {
        why: "No check due right now",
        guidance:
          "Your next check opens when its window does. Refresh if you expect one to be open already.",
      };
  }
}

/** Copy when a caregiver opens a resident and no check is open for them. */
export function describeCaregiverResidentRoundEmptyState(args: {
  taskQueuedLocally: boolean;
}): CaregiverRoundsEmptyCopy {
  if (args.taskQueuedLocally) {
    return {
      why: "Check queued to send",
      guidance: "It uploads on its own as soon as the device is back on the network.",
    };
  }
  return {
    why: "No check open for this resident",
    guidance:
      "Nothing is due for them right now. Go back to the queue, or refresh if a check should be open.",
  };
}

/**
 * A queue count on the caregiver rounds header (COL-649). After a failed read
 * (a 403 "No caregiver staff profile found", a 500) the counts are unknown, not
 * "Critical 0 / Due now 0"; without a facility there is no queue to count.
 */
export function caregiverRoundsCount(
  input: { loadError: string | null; noFacility: boolean },
  count: number,
): MetricState<number> {
  if (input.noFacility) return metricNotConfigured("No facility");
  if (input.loadError) return metricUnavailable();
  return metricValue(count);
}

export const CAREGIVER_ROUNDS_LOAD_FAILED_COPY =
  "Your queue could not be loaded, so the counts below are unknown. Use Refresh to try again.";
