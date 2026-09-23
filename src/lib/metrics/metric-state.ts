/**
 * MetricState — what a KPI slot actually knows (COL-649).
 *
 * A displayed metric is one of:
 *   - `loading`         the read has not finished
 *   - `unavailable`     the read failed (query error, 4xx/5xx, RLS refusal)
 *   - `not_configured`  nothing can be read yet: no facility chosen, module not
 *                       set up, no scope to measure
 *   - `no_data`         the read succeeded but there is nothing to measure from
 *                       (no residents, no payments, no schedule weeks)
 *   - `value`           a real figure
 *
 * Only `value` may render as a number, and only `value` may carry tone. The
 * other four render as a short muted phrase, never as 0 / 100% / "All clear".
 * The guard in `false-all-clear.source.test.ts` stops new `?? 0` fallbacks on
 * rendered metrics; this module is what to use instead.
 */

export type MetricStatus = "loading" | "unavailable" | "not_configured" | "no_data" | "value";

export type MetricState<T> =
  | { status: "loading" }
  | { status: "unavailable"; reason?: string }
  | { status: "not_configured"; reason?: string }
  | { status: "no_data"; reason?: string }
  | { status: "value"; value: T };

export const METRIC_PLACEHOLDER: Record<Exclude<MetricStatus, "value">, string> = {
  loading: "Loading…",
  unavailable: "Unavailable",
  not_configured: "Not set up",
  no_data: "No data",
};

/** Placeholder when the only thing missing is a facility choice. */
export const SELECT_FACILITY_PLACEHOLDER = "Select a facility";

export const metricLoading = <T = never>(): MetricState<T> => ({ status: "loading" });
export const metricUnavailable = <T = never>(reason?: string): MetricState<T> => ({ status: "unavailable", reason });
export const metricNotConfigured = <T = never>(reason?: string): MetricState<T> => ({
  status: "not_configured",
  reason,
});
export const metricNoData = <T = never>(reason?: string): MetricState<T> => ({ status: "no_data", reason });
export const metricValue = <T>(value: T): MetricState<T> => ({ status: "value", value });

/** No facility selected: the slot names the missing choice instead of a zero. */
export const metricNeedsFacility = <T = never>(): MetricState<T> => metricNotConfigured(SELECT_FACILITY_PLACEHOLDER);

export function hasMetricValue<T>(state: MetricState<T>): state is { status: "value"; value: T } {
  return state.status === "value";
}

/**
 * State for a Supabase head count (`{ count, error }`). A null count with no
 * error is treated as unavailable too: PostgREST only omits it when the
 * request did not run as a count, which is a defect, not "none".
 */
export function metricFromCount(input: {
  count: number | null | undefined;
  error?: unknown;
  loading?: boolean;
}): MetricState<number> {
  if (input.loading) return metricLoading();
  if (input.error) return metricUnavailable();
  if (typeof input.count !== "number" || !Number.isFinite(input.count)) return metricUnavailable();
  return metricValue(input.count);
}

/**
 * State for a derived figure. `value` null/undefined/NaN with a successful read
 * means there was nothing to compute from (`no_data`), e.g. a rate with a zero
 * denominator.
 */
export function metricFromRead<T>(input: {
  loading?: boolean;
  error?: unknown;
  /** False when the read could not run (no facility chosen, no scope). */
  scopeReady?: boolean;
  notConfiguredReason?: string;
  value: T | null | undefined;
  noDataReason?: string;
}): MetricState<T> {
  if (input.scopeReady === false) return metricNotConfigured(input.notConfiguredReason ?? SELECT_FACILITY_PLACEHOLDER);
  if (input.loading) return metricLoading();
  if (input.error) return metricUnavailable();
  const v = input.value;
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) {
    return metricNoData(input.noDataReason);
  }
  return metricValue(v);
}

/** A rate needs a non-zero denominator; otherwise there is nothing to measure. */
export function metricRate(input: {
  numerator: number | null | undefined;
  denominator: number | null | undefined;
  loading?: boolean;
  error?: unknown;
  scopeReady?: boolean;
  noDataReason?: string;
  /** Multiply by 100 (default) to return a percentage. */
  asPercent?: boolean;
}): MetricState<number> {
  const { numerator, denominator } = input;
  const computable =
    typeof numerator === "number" &&
    typeof denominator === "number" &&
    Number.isFinite(numerator) &&
    Number.isFinite(denominator) &&
    denominator > 0;
  const ratio = computable ? numerator / denominator : null;
  return metricFromRead({
    loading: input.loading,
    error: input.error,
    scopeReady: input.scopeReady,
    noDataReason: input.noDataReason,
    value: ratio === null ? null : input.asPercent === false ? ratio : ratio * 100,
  });
}

export function mapMetric<T, U>(state: MetricState<T>, fn: (value: T) => U): MetricState<U> {
  return state.status === "value" ? metricValue(fn(state.value)) : state;
}

/** The phrase a non-value state renders as. */
export function metricPlaceholder(state: Exclude<MetricState<unknown>, { status: "value" }>): string {
  if (state.status === "loading") return METRIC_PLACEHOLDER.loading;
  return state.reason || METRIC_PLACEHOLDER[state.status];
}

/** Text for the slot: the formatted value, or the honest placeholder. */
export function formatMetric<T>(state: MetricState<T>, format: (value: T) => string = String): string {
  return state.status === "value" ? format(state.value) : metricPlaceholder(state);
}

/**
 * The only door to reassuring copy ("All clear", "All verified", "In good
 * standing", "Coverage is currently sufficient"). True only when the read
 * finished without error, the scope was real (a facility or a non-empty set of
 * things was actually examined), and it found nothing wrong.
 *
 * `scopeSize` is how many things were examined — residents, drills, schedule
 * weeks, certifications. Zero examined is "nothing to check", not "clear".
 */
export function canClaimAllClear(input: {
  loading?: boolean;
  error?: unknown;
  scopeReady?: boolean;
  scopeSize: number | null | undefined;
  issueCount: number | null | undefined;
}): boolean {
  if (input.loading || input.error || input.scopeReady === false) return false;
  if (typeof input.scopeSize !== "number" || input.scopeSize <= 0) return false;
  return input.issueCount === 0;
}

/**
 * Averages only the members that have a value, and says how many were left
 * out. Use for portfolio figures (occupancy across facilities) so a facility
 * with no census does not drag the average toward 0.
 */
export function averageOfReported<T>(
  items: readonly T[],
  pick: (item: T) => number | null | undefined,
): { state: MetricState<number>; reported: number; excluded: number } {
  const values = items.map(pick).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const excluded = items.length - values.length;
  if (values.length === 0) {
    return { state: metricNoData(), reported: 0, excluded };
  }
  return {
    state: metricValue(values.reduce((sum, v) => sum + v, 0) / values.length),
    reported: values.length,
    excluded,
  };
}
