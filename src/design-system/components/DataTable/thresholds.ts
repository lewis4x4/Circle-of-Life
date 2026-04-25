export type ThresholdDirection = "up" | "down";

export type ThresholdSpec = {
  target: number;
  direction: ThresholdDirection;
  /** Default 10. Pass 0 to disable warning band. */
  warningBandPct?: number;
};

export type ThresholdMap = Record<string, ThresholdSpec>;

export type ThresholdState = "ok" | "warning" | "critical" | "no-threshold";

/**
 * Resolve a single value against a threshold spec.
 *
 * - direction `up`  → larger is better; below target enters warning/critical bands
 * - direction `down`→ smaller is better; above target enters warning/critical bands
 *
 * Default warning band is `±10%` of target unless overridden via `warningBandPct`.
 */
export function resolveThresholdState(
  value: number,
  spec: ThresholdSpec | undefined,
): ThresholdState {
  if (spec === undefined) return "no-threshold";
  if (!Number.isFinite(value)) return "no-threshold";

  const bandPct = spec.warningBandPct ?? 10;
  const band = Math.abs(spec.target) * (bandPct / 100);

  if (spec.direction === "up") {
    if (value >= spec.target) return "ok";
    if (value >= spec.target - band) return "warning";
    return "critical";
  }

  // direction === "down"
  if (value <= spec.target) return "ok";
  if (value <= spec.target + band) return "warning";
  return "critical";
}

export function thresholdStateToToneClass(state: ThresholdState): string {
  switch (state) {
    case "ok":
      return "text-success";
    case "warning":
      return "text-warning";
    case "critical":
      return "text-danger";
    default:
      return "text-text-primary";
  }
}
