"use client";

import * as React from "react";

import { formatMetric, type MetricState } from "@/lib/metrics/metric-state";
import { cn } from "@/lib/utils";

/** Semantic accent on KPI value only (Quiet Operator KPI strip). */
export type KpiCardTone = "neutral" | "warning" | "danger" | "success";

const valueToneClass: Record<KpiCardTone, string> = {
  neutral: "text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
  success: "text-emerald-600 dark:text-emerald-400",
};

export type KpiCardProps = {
  /** Large numeric or em-dash display. Prefer `state` for read-backed figures. */
  value?: React.ReactNode;
  /**
   * What the read actually knows (COL-649). A non-value state renders its
   * phrase ("Unavailable", "Select a facility", "No data") as a muted message
   * and drops `tone`, so a failed read never shows as a coloured 0.
   */
  state?: MetricState<React.ReactNode>;
  /** Sentence-case label beneath the value. */
  label: React.ReactNode;
  tone?: KpiCardTone;
  /** Secondary line (trend deltas, ISO range hints). */
  footnote?: React.ReactNode;
  /** `message` — one-line empty-state copy at 13px muted (Quiet Operator). */
  valuePresentation?: "metric" | "message";
  className?: string;
};

/** Quiet Operator KPI tile — dominant value (28px), muted label below, optional threshold tone on value only. */
export function KpiCard({
  value,
  state,
  label,
  tone = "neutral",
  footnote,
  valuePresentation = "metric",
  className,
}: KpiCardProps) {
  const placeholder = state && state.status !== "value" ? formatMetric(state) : null;
  const presentation = placeholder !== null ? "message" : valuePresentation;
  const shown = placeholder ?? (state?.status === "value" ? state.value : value);
  return (
    <div
      data-metric-state={state?.status}
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)] ring-1 ring-border/60",
        className,
      )}
    >
      <p
        className={cn(
          presentation === "message"
            ? "text-[13px] font-medium leading-snug text-muted-foreground"
            : cn("text-[28px] font-semibold tabular-nums leading-tight tracking-normal", valueToneClass[tone]),
        )}
      >
        {shown}
      </p>
      <p className="mt-2 text-[13px] font-normal leading-snug text-muted-foreground tracking-normal">{label}</p>
      {footnote ? <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}
