"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { portfolioOccupancyBarClass, portfolioOccupancyKpiTextClass } from "@/lib/admin/facilities/portfolio-metrics";

interface OccupancyGaugeProps {
  occupied: number;
  total: number;
  size?: "sm" | "lg";
  /** Portfolio facilities hub — aligns bar + percentage label with KPI semantic scale. */
  portfolioSemantics?: boolean;
}

export function OccupancyGauge({ occupied, total, size = "sm", portfolioSemantics = false }: OccupancyGaugeProps) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, (occupied / total) * 100)) : 0;
  const rounded = Math.round(percentage);

  if (size === "lg") {
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (percentage / 100) * circumference;

    let colorClass = "text-success";
    if (percentage >= 90 && percentage < 95) {
      colorClass = "text-warning";
    } else if (percentage >= 95) {
      colorClass = "text-destructive";
    }

    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-32 w-32">
          <svg className="h-32 w-32 -rotate-90 transform" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-muted/40"
            />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={cn("transition-all duration-500", colorClass)}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-3xl font-semibold tabular-nums">{rounded}%</div>
              <div className="text-xs text-muted-foreground">
                {occupied}/{total}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const barFill = portfolioSemantics ? portfolioOccupancyBarClass(rounded) : occupancyLegBarClass(percentage);
  const pctClass = portfolioSemantics
    ? portfolioOccupancyKpiTextClass(rounded)
    : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {occupied}/{total} beds
        </span>
        <span className={cn("text-sm font-medium tabular-nums", pctClass)}>{rounded}%</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/60">
        <div className={cn("h-full transition-all duration-500", barFill)} style={{ width: `${rounded}%` }} />
      </div>
    </div>
  );
}

function occupancyLegBarClass(percentage: number): string {
  if (percentage >= 95) return "bg-destructive";
  if (percentage >= 90) return "bg-warning";
  return "bg-success";
}
