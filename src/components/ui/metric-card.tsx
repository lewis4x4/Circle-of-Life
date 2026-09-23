"use client";

import * as React from "react";

import { formatMetric, type MetricState } from "@/lib/metrics/metric-state";
import { cn } from "@/lib/utils";

export type MetricTone = "default" | "success" | "warning" | "danger";

export type MetricThresholds =
  | { type: "critical-count" }
  | { type: "overdue-count" }
  | { type: "rate-percent" }
  | { type: "informational" }
  | { type: "completed-count" }
  | { type: "custom"; resolve: (value: number) => MetricTone };

export function resolveMetricTone(value: number, thresholds?: MetricThresholds): MetricTone {
  if (!Number.isFinite(value)) return "default";
  if (!thresholds) return "default";

  switch (thresholds.type) {
    case "critical-count":
      return value >= 1 ? "danger" : "default";
    case "overdue-count":
      if (value >= 4) return "danger";
      if (value >= 1) return "warning";
      return "default";
    case "rate-percent":
      if (value < 50) return "danger";
      if (value < 80) return "warning";
      return "success";
    case "informational":
      return "default";
    case "completed-count":
      return value > 0 ? "default" : "default";
    case "custom":
      return thresholds.resolve(value);
  }
}

const toneClasses: Record<MetricTone, { card: string; value: string }> = {
  default: { card: "border-border", value: "text-foreground" },
  success: { card: "border-success/30", value: "text-success" },
  warning: { card: "border-warning/40", value: "text-warning" },
  danger: { card: "border-destructive/40", value: "text-destructive" },
};

export type MetricCardProps = React.HTMLAttributes<HTMLElement> & {
  label: string;
  /** Prefer `state` for read-backed figures. */
  value?: React.ReactNode;
  /**
   * What the read actually knows (COL-649). A non-value state renders its
   * phrase in muted text with default tone; thresholds are not applied.
   */
  state?: MetricState<number>;
  /** Formats `state.value`. Defaults to `String`. */
  format?: (value: number) => string;
  numericValue?: number;
  hint?: React.ReactNode;
  tone?: MetricTone;
  thresholds?: MetricThresholds;
};

/** Value-derived KPI card. Prefer thresholds over caller-supplied tone. */
export function MetricCard({
  label,
  value,
  state,
  format,
  numericValue,
  hint,
  tone,
  thresholds,
  className,
  ...props
}: MetricCardProps) {
  const placeholder = state && state.status !== "value" ? formatMetric(state) : null;
  const shownValue: React.ReactNode =
    placeholder ?? (state?.status === "value" ? (format ? format(state.value) : state.value) : value);
  const resolvedNumericValue = state?.status === "value" ? state.value : (numericValue ?? Number(value));
  const derivedTone =
    placeholder !== null
      ? "default"
      : thresholds
        ? resolveMetricTone(resolvedNumericValue, thresholds)
        : (tone ?? "default");
  const classes = toneClasses[derivedTone];

  return (
    <article
      aria-label={`${label}: ${String(shownValue)}`}
      data-metric-state={state?.status}
      className={cn("flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-3", classes.card, className)}
      {...props}
    >
      <span className="text-[13px] font-medium normal-case tracking-normal text-muted-foreground">{label}</span>
      {placeholder !== null ? (
        <span className="text-base font-medium leading-8 text-muted-foreground">{placeholder}</span>
      ) : (
        <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", classes.value)}>{shownValue}</span>
      )}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </article>
  );
}
