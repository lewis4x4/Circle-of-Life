"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import type { FacilityRow } from "@/types/facility";
import type { StatusPillTone } from "@/components/ui/status-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { OccupancyGauge } from "./shared/OccupancyGauge";
import { cn } from "@/lib/utils";
import {
  facilityOccupancyDenominator,
  facilityOccupiedCount,
  portfolioFacilityCardFieldEmptyCopy,
} from "@/lib/admin/facilities/portfolio-hub-kpi-copy";
import { portfolioLaborCostTextClass } from "@/lib/admin/facilities/portfolio-metrics";

interface FacilityCardProps {
  facility: FacilityRow;
}

function facilityOperationalStatusTone(
  status: string | undefined | null,
): { label: string; tone: StatusPillTone } | null {
  const normalized = String(status ?? "active").toLowerCase();
  if (!normalized || normalized === "active") return null;

  switch (normalized) {
    case "inactive":
      return { label: "Inactive", tone: "warning" };
    case "under_renovation":
      return { label: "Under renovation", tone: "info" };
    case "archived":
      return { label: "Archived", tone: "muted" };
    default:
      return {
        label: normalized.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        tone: "warning",
      };
  }
}

function formatIncidentSummary(facility: FacilityRow): string {
  const total = typeof facility.portfolio_open_incidents_total === "number" ? facility.portfolio_open_incidents_total : 0;
  const lvl3 =
    typeof facility.portfolio_open_incidents_level_3 === "number" ? facility.portfolio_open_incidents_level_3 : 0;
  if (total <= 0) return "0";
  if (lvl3 > 0) return `${total} (${lvl3} sev-3)`;
  return String(total);
}

function LaborMtdCell({ facility }: { facility: FacilityRow }) {
  const emptyCopy = portfolioFacilityCardFieldEmptyCopy("labor_mtd", facility);
  if (emptyCopy) {
    return <span className="text-[12px] font-medium leading-snug text-muted-foreground">{emptyCopy}</span>;
  }
  const v = facility.labor_cost_mtd_pct!;
  return (
    <span className={cn("font-semibold tabular-nums", portfolioLaborCostTextClass(v))}>{v.toFixed(1)}%</span>
  );
}

export function FacilityCard({ facility }: FacilityCardProps) {
  const occupancyEmptyCopy = portfolioFacilityCardFieldEmptyCopy("occupancy", facility);
  const surveyEmptyCopy = portfolioFacilityCardFieldEmptyCopy("survey_readiness", facility);
  const locationEmptyCopy = portfolioFacilityCardFieldEmptyCopy("location", facility);

  const occupiedBeds = facilityOccupiedCount(facility);
  const totalForGauge = facilityOccupancyDenominator(facility);

  const administratorDisplay = facility.administrator_name?.trim() || "";
  const hasAdministrator = administratorDisplay.length > 0;
  const city = facility.city ?? "";
  const county = facility.county ?? "";
  const location = [city, county].filter(Boolean).join(", ");

  const statusPill = facilityOperationalStatusTone(facility.status);

  return (
    <article
      className={cn(
        "flex min-h-[240px] flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors",
        "hover:border-ring/35 hover:bg-card/80 focus-within:border-ring/50",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <Link href={`/admin/facilities/${facility.id}`} className="group/name block min-w-0">
              <h3 className="text-lg font-semibold tracking-tight text-foreground underline-offset-4 hover:underline">
                {facility.name}
              </h3>
            </Link>
            {statusPill ? (
              <StatusPill tone={statusPill.tone} className="normal-case tracking-normal">
                {statusPill.label}
              </StatusPill>
            ) : null}
          </div>
          {locationEmptyCopy ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{locationEmptyCopy}</p>
          ) : (
            <p className="mt-1.5 truncate text-sm text-muted-foreground">{location}</p>
          )}
        </div>

        <Link
          href={`/admin/facilities/${facility.id}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
          aria-label={`Open ${facility.name} facility overview`}
        >
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </div>

      {occupancyEmptyCopy ? (
        <p className="text-[13px] font-medium leading-snug text-muted-foreground">{occupancyEmptyCopy}</p>
      ) : (
        <OccupancyGauge
          occupied={occupiedBeds}
          total={totalForGauge}
          size="sm"
          portfolioSemantics
        />
      )}

      <div className="my-4 h-px w-full shrink-0 bg-border" />

      <dl className="grid flex-1 auto-rows-fr gap-x-6 gap-y-2.5 text-sm">
        <div className="grid grid-cols-[1fr_auto] items-start gap-x-3">
          <dt className="text-muted-foreground">Open incidents</dt>
          <dd className="text-right font-semibold tabular-nums text-foreground">{formatIncidentSummary(facility)}</dd>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-start gap-x-3">
          <dt className="text-muted-foreground">Survey readiness</dt>
          <dd className="max-w-[60%] text-right font-semibold text-foreground">
            {surveyEmptyCopy ? (
              <span className="text-[12px] font-medium leading-snug text-muted-foreground">{surveyEmptyCopy}</span>
            ) : (
              <span className="line-clamp-2">{`${Math.round(facility.survey_readiness_pct!)}% ready`}</span>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-start gap-x-3">
          <dt className="text-muted-foreground">Labor cost MTD</dt>
          <dd className="text-right tabular-nums">
            <LaborMtdCell facility={facility} />
          </dd>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Administrator</dt>
          <dd className="text-right font-semibold text-foreground">
            {hasAdministrator ? (
              facility.administrator_staff_id ? (
                <Link
                  href={`/admin/staff/${facility.administrator_staff_id}`}
                  className="text-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {administratorDisplay}
                </Link>
              ) : (
                <span className="tabular-nums">{administratorDisplay}</span>
              )
            ) : (
              <span className="inline-flex items-center justify-end gap-1 text-warning tabular-nums">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                Unassigned
              </span>
            )}
          </dd>
        </div>
      </dl>

      <Link
        href={`/admin/facilities/${facility.id}`}
        className="mt-4 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Open facility overview
      </Link>
    </article>
  );
}
