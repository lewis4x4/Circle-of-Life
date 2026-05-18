"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { FacilityRow } from "@/types/facility";
import {
  portfolioLaborCostTextClass,
  portfolioOccupancyKpiTextClass,
} from "@/lib/admin/facilities/portfolio-metrics";

function daysSinceLastSurvey(date: string | null | undefined): number | null {
  if (date == null || typeof date !== "string" || date.trim() === "") return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

interface FacilityOperationsMetricsStripProps {
  facility: FacilityRow;
}

/** Operations KPI strip for facility Overview and related contexts. */
export function FacilityOperationsMetricsStrip({ facility }: FacilityOperationsMetricsStripProps) {
  const openIncidents = facility.portfolio_open_incidents_total ?? 0;
  const level3 = facility.portfolio_open_incidents_level_3 ?? 0;
  const readiness = facility.survey_readiness_pct;
  const laborPct = facility.labor_cost_mtd_pct;
  const days = daysSinceLastSurvey(facility.last_survey_date);

  const laborOk = typeof laborPct === "number" && Number.isFinite(laborPct);
  const readinessOk = typeof readiness === "number" && Number.isFinite(readiness);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Open incidents</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{openIncidents}</p>
        {level3 > 0 ? (
          <p className="mt-1 text-[12px] tabular-nums text-warning">{level3} level 3 open</p>
        ) : null}
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Labor cost (MTD)</p>
        <p
          className={cn(
            "mt-2 text-3xl font-semibold tabular-nums",
            laborOk ? portfolioLaborCostTextClass(laborPct!) : "text-muted-foreground",
          )}
        >
          {laborOk ? `${Math.round(laborPct)}%` : "—"}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">Share of census revenue</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Survey readiness</p>
        <p
          className={cn(
            "mt-2 text-3xl font-semibold tabular-nums",
            readinessOk ? portfolioOccupancyKpiTextClass(readiness!) : "text-muted-foreground",
          )}
        >
          {readinessOk ? `${Math.round(readiness)}%` : "—"}
        </p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Days since survey</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
          {typeof days === "number" ? days : "—"}
        </p>
      </div>
    </div>
  );
}

/** @deprecated Prefer `FacilityOperationsMetricsStrip`; kept for transitional imports on older routes. */
export const FacilityHeader = FacilityOperationsMetricsStrip;
