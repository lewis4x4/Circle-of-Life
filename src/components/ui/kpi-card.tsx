"use client";

import * as React from "react";

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
  /** Large numeric or em-dash display. */
  value: React.ReactNode;
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
  label,
  tone = "neutral",
  footnote,
  valuePresentation = "metric",
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)] ring-1 ring-border/60",
        className,
      )}
    >
      <p
        className={cn(
          valuePresentation === "message"
            ? "text-[13px] font-medium leading-snug text-muted-foreground"
            : cn("text-[28px] font-semibold tabular-nums leading-tight tracking-normal", valueToneClass[tone]),
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[13px] font-normal leading-snug text-muted-foreground tracking-normal">{label}</p>
      {footnote ? <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}
