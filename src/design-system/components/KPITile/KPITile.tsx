"use client";

import { useId, useState } from "react";

import { Sparkline, type SparklineTone } from "../Sparkline";
import { TrendDelta } from "../TrendDelta";
import { cn } from "@/lib/utils";

export type KPITileTone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "regulatory";

export type KPITileTrend = {
  direction: "up" | "down" | "flat";
  value: number;
  unit: "pp" | "pts" | "%" | "days";
  period: string;
  goodDirection?: "up" | "down";
};

export type KPITileProps = {
  label: string;
  value: string | number;
  unit?: string;
  trend?: KPITileTrend;
  tone?: KPITileTone;
  sparkline?: number[];
  info?: string;
  breachMessage?: React.ReactNode;
  onClick?: () => void;
  className?: string;
};

const TONE_TO_CONTAINER: Record<KPITileTone, string> = {
  default: "border-border bg-surface",
  success: "border-success bg-surface",
  warning: "border-warning bg-surface",
  danger: "border-danger bg-surface",
  info: "border-info bg-surface",
  regulatory: "border-regulatory bg-surface",
};

const TONE_TO_VALUE_TEXT: Record<KPITileTone, string> = {
  default: "text-text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  regulatory: "text-regulatory",
};

const TONE_TO_SPARKLINE: Record<KPITileTone, SparklineTone> = {
  default: "default",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  regulatory: "regulatory",
};

export function KPITile({
  label,
  value,
  unit,
  trend,
  tone = "default",
  sparkline,
  info,
  breachMessage,
  onClick,
  className,
}: KPITileProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();
  const Tag = onClick ? "button" : "article";
  const tagProps = onClick
    ? {
        type: "button" as const,
        onClick,
        "aria-label": `${label}: ${value}${unit ?? ""}. Open details.`,
      }
    : {
        "aria-label": `${label}: ${value}${unit ?? ""}`,
      };

  return (
    <Tag
      {...tagProps}
      data-tone={tone}
      className={cn(
        "group relative flex min-w-0 flex-col gap-2 rounded-md border px-4 py-3 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
        onClick ? "cursor-pointer transition-colors hover:border-border-strong" : "cursor-default",
        TONE_TO_CONTAINER[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {label}
        </span>
        {info && (
          <span className="relative">
            <button
              type="button"
              aria-label={`Info for ${label}`}
              aria-describedby={infoOpen ? infoId : undefined}
              aria-expanded={infoOpen}
              onClick={(event) => {
                event.stopPropagation();
                setInfoOpen((prev) => !prev);
              }}
              onBlur={() => setInfoOpen(false)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-elevated text-xs font-semibold text-text-secondary hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              i
            </button>
            {infoOpen && (
              <span
                role="tooltip"
                id={infoId}
                className="absolute right-0 top-6 z-10 w-56 rounded-md border border-border bg-surface-elevated p-2 text-xs text-text-secondary shadow-panel"
              >
                {info}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            TONE_TO_VALUE_TEXT[tone],
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium text-text-secondary">{unit}</span>
        )}
      </div>

      {(trend || sparkline) && (
        <div className="flex items-center justify-between gap-3">
          {trend ? (
            <TrendDelta
              direction={trend.direction}
              value={trend.value}
              unit={trend.unit}
              period={trend.period}
              goodDirection={trend.goodDirection}
            />
          ) : (
            <span />
          )}
          {sparkline && sparkline.length >= 2 && (
            <Sparkline
              data={sparkline}
              tone={TONE_TO_SPARKLINE[tone]}
              ariaLabel={`${label} sparkline trend`}
            />
          )}
        </div>
      )}

      {breachMessage && (
        <p
          role="note"
          className={cn(
            "rounded-sm border px-2 py-1 text-xs font-medium",
            tone === "danger"
              ? "border-danger bg-surface-subtle text-danger"
              : tone === "warning"
                ? "border-warning bg-surface-subtle text-warning"
                : "border-border bg-surface-subtle text-text-secondary",
          )}
        >
          {breachMessage}
        </p>
      )}
    </Tag>
  );
}
