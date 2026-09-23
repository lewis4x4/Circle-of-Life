import {
  metricNoData,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";

/**
 * Residents-today tiles on Home (COL-649). A roster with nobody on it at an
 * operating facility is an unloaded roster, not "0 in house": the 2026-09-22
 * audit found "0 in house" beside a Stand Up census of 47.
 */
export const ROSTER_EMPTY_TILE = "None on roster";

export function presenceTileState(input: {
  available: boolean;
  rosterTotal: number;
  value: number;
}): MetricState<number> {
  if (!input.available) return metricUnavailable();
  if (input.rosterTotal <= 0) return metricNoData(ROSTER_EMPTY_TILE);
  return metricValue(input.value);
}

/** Subtitle: an empty roster is not "0 on census · 54 open". The note below the tiles says what to do. */
export function presenceSubtitle(input: {
  available: boolean;
  rosterTotal: number;
  licensedBeds: number | null;
  openBeds: number | null;
}): string {
  if (!input.available) return "Roster counts unavailable right now.";
  if (input.rosterTotal <= 0) return "No residents are on the roster yet, so these tiles are not a census.";
  return `${input.rosterTotal} on census${input.licensedBeds != null ? ` · ${input.licensedBeds} licensed beds · ${input.openBeds} open` : ""}. Every held bed counts.`;
}
