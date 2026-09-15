/**
 * Change between two recordings of the same metric.
 *
 * An arrow on this page used to mean "this value is above or below a threshold"
 * while looking exactly like "this value moved". Only a comparison against a
 * named earlier recording earns an arrow here: same metric, same scope, two
 * different recorded days. Anything else returns no change, and the page says
 * there is nothing to compare rather than drawing a direction.
 */

export type MetricChangeFormat = "pct" | "num" | "cur";

export type MetricSnapshotDatedRow = {
  facility_id: string | null;
  metric_code: string;
  metric_value_numeric: number | null;
  snapshot_date: string;
};

export type MetricChange = {
  metricCode: string;
  current: number;
  currentDate: string;
  previous: number;
  previousDate: string;
  /** current − previous, in the metric's own units. */
  delta: number;
  direction: "up" | "down" | "flat";
};

export const METRIC_CHANGE_UNAVAILABLE_COPY = "No earlier recording to compare.";

/** Occupancy is read live from the bed grid, so there is no prior recording of the same thing. */
export const OCCUPANCY_CHANGE_UNAVAILABLE_COPY =
  "Read from the current bed census — no earlier posting to compare.";

function isValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Portfolio-scope changes keyed by metric code. Rows are expected newest-first;
 * facility-scoped rows are ignored so a change never mixes cohorts.
 */
export function buildPortfolioMetricChanges(
  rows: ReadonlyArray<MetricSnapshotDatedRow>,
): Record<string, MetricChange> {
  const byCode = new Map<string, MetricSnapshotDatedRow[]>();
  for (const row of rows) {
    if (row.facility_id !== null) continue;
    if (!isValue(row.metric_value_numeric)) continue;
    const bucket = byCode.get(row.metric_code) ?? [];
    bucket.push(row);
    byCode.set(row.metric_code, bucket);
  }

  const changes: Record<string, MetricChange> = {};
  for (const [metricCode, bucket] of byCode) {
    const ordered = [...bucket].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
    const current = ordered[0];
    if (!current) continue;
    const previous = ordered.find((row) => row.snapshot_date !== current.snapshot_date);
    if (!previous) continue;

    const currentValue = current.metric_value_numeric ?? 0;
    const previousValue = previous.metric_value_numeric ?? 0;
    const delta = currentValue - previousValue;
    changes[metricCode] = {
      metricCode,
      current: currentValue,
      currentDate: current.snapshot_date,
      previous: previousValue,
      previousDate: previous.snapshot_date,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    };
  }
  return changes;
}

function formatDelta(delta: number, format: MetricChangeFormat): string {
  const magnitude = Math.abs(delta);
  if (format === "pct") return `${(magnitude * 100).toFixed(1)} pts`;
  if (format === "cur") return `$${Math.round(magnitude / 100).toLocaleString()}`;
  return magnitude.toFixed(1);
}

/** "+1.2 pts since 2026-09-14" — always dated, so the reader knows the baseline. */
export function metricChangeLine(
  change: MetricChange | undefined,
  format: MetricChangeFormat,
): string {
  if (!change) return METRIC_CHANGE_UNAVAILABLE_COPY;
  if (change.direction === "flat") return `No change since ${change.previousDate}.`;
  const sign = change.direction === "up" ? "+" : "−";
  return `${sign}${formatDelta(change.delta, format)} since ${change.previousDate}.`;
}
