"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  portfolioOccupancyBarClass,
  portfolioOccupancyKpiTextClass,
  portfolioOccupancyRingStrokeClass,
} from "@/lib/admin/facilities/portfolio-metrics";

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
    const offset = circumference - (rounded / 100) * circumference;

    let ringClass = legacyRingStrokeClass(rounded);
    let centerPctClass = "text-success";
    if (portfolioSemantics) {
      ringClass = portfolioOccupancyRingStrokeClass(rounded);
      centerPctClass = portfolioOccupancyKpiTextClass(rounded);
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
              className={cn("transition-all duration-500", ringClass)}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className={cn("text-3xl font-semibold tabular-nums", centerPctClass)}>{rounded}%</div>
              <div className="text-xs text-muted-foreground tabular-nums">
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

function legacyRingStrokeClass(percentage: number): string {
  if (percentage >= 95) return "text-destructive";
  if (percentage >= 90) return "text-warning";
  return "text-success";
}

function occupancyLegBarClass(percentage: number): string {
  if (percentage >= 95) return "bg-destructive";
  if (percentage >= 90) return "bg-warning";
  return "bg-success";
}
