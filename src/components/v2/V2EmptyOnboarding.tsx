"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { V2DashboardId } from "@/lib/v2-dashboards";

type Step = {
  title: string;
  body: string;
  href: string;
  cta: string;
};

const STEPS_BY_DASHBOARD: Record<V2DashboardId, readonly Step[]> = {
  "command-center": [
    {
      title: "Run the executive KPI snapshot",
      body: "Generates open alerts, eMAR variance, falls, survey window, active admits, and family-message backlog from live operational data.",
      href: "/admin/executive/settings",
      cta: "Open snapshot settings",
    },
    {
      title: "Wire eMAR + incident feeds",
      body: "Connect the eMAR variance + incident streams so the triage queue, alerts, and action queue populate.",
      href: "/admin/admin/medications",
      cta: "Open medications",
    },
    {
      title: "Configure alert rules",
      body: "Define what surfaces in the alerts panel: severity, lookback window, and acknowledgement workflow.",
      href: "/admin/executive/alerts",
      cta: "Open alerts",
    },
  ],
  "executive-intelligence": [
    {
      title: "Run the executive KPI snapshot",
      body: "Generates occupancy, labor cost, revenue (TTM), margin, NPS, and risk score from live operational data.",
      href: "/admin/executive/settings",
      cta: "Open snapshot settings",
    },
    {
      title: "Generate the first Smart Rounding rollup",
      body: "Computes watch load, escalation pressure, and integrity flags per facility. Populates the heat map and 7-day trend chart.",
      href: "/admin/rounding",
      cta: "Open assurance hub",
    },
    {
      title: "Configure executive alert rules",
      body: "Define the thresholds that surface critical alerts in the right-rail watchlist (occupancy drop, labor overrun, severity-4 incident, etc.).",
      href: "/admin/executive/alerts",
      cta: "Open alerts",
    },
    {
      title: "Set facility-level metric thresholds",
      body: "Each facility can carry its own occupancy / labor / incident thresholds. The dashboard colors these once they're set.",
      href: "/admin/settings/thresholds",
      cta: "Open thresholds",
    },
  ],
  "clinical-quality": [
    {
      title: "Generate the first quality measure run",
      body: "Computes eMAR variance, falls per 1k bed-days, pressure injuries, readmissions, care plans on time, and infection rate.",
      href: "/admin/quality/measures",
      cta: "Open quality measures",
    },
    {
      title: "Connect incident + infection data",
      body: "Quality metrics derive from the incident queue + infection-control log. Confirm those feeds before reviewing trends.",
      href: "/admin/admin/infection-control",
      cta: "Open infection control",
    },
    {
      title: "Set facility-level quality thresholds",
      body: "Tone-color the table by configuring facility-specific targets for each measure.",
      href: "/admin/settings/thresholds",
      cta: "Open thresholds",
    },
  ],
  "rounding-operations": [
    {
      title: "Enable rounding for one facility",
      body: "Activates round cadence tracking, watch load, escalation pipeline, and integrity flags for the selected facility.",
      href: "/admin/admin/rounding",
      cta: "Open rounding hub",
    },
    {
      title: "Configure round templates",
      body: "Set the question packs and expected cadence per unit. Rounds inherit these and surface on the round-cadence panel.",
      href: "/admin/admin/rounding/plans",
      cta: "Open plans",
    },
    {
      title: "Run the first integrity scan",
      body: "Surfaces late-entry rounds, missing evidence, and acknowledgement gaps. Populates the integrity score KPI.",
      href: "/admin/admin/rounding/integrity",
      cta: "Open integrity",
    },
  ],
};

const SHELL_LABEL_BY_DASHBOARD: Record<V2DashboardId, string> = {
  "command-center": "command center",
  "executive-intelligence": "executive shell",
  "clinical-quality": "clinical quality shell",
  "rounding-operations": "rounding-operations shell",
};

export type V2EmptyOnboardingProps = {
  dashboardId: V2DashboardId;
  facilityCount: number;
};

export function V2EmptyOnboarding({ dashboardId, facilityCount }: V2EmptyOnboardingProps) {
  const steps = STEPS_BY_DASHBOARD[dashboardId];
  const shellLabel = SHELL_LABEL_BY_DASHBOARD[dashboardId];

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
          You&rsquo;re connected, but no live data has landed yet
        </h2>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {facilityCount > 0
            ? `${facilityCount} ${facilityCount === 1 ? "facility is" : "facilities are"} in scope. Once the underlying jobs run, this dashboard fills in automatically.`
            : "Add a facility to start collecting operational data. Once it's in scope, the underlying jobs will populate this dashboard."}
        </p>
      </div>

      <ol className="mt-5 flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-[11px] font-medium tabular-nums text-foreground">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
                  {step.title}
                </h3>
                <Link
                  href={step.href}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5",
                    "text-[12px] font-medium text-muted-foreground transition-colors",
                    "hover:bg-secondary hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {step.cta} <ArrowRight className="size-3" aria-hidden />
                </Link>
              </div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center gap-2 border-t border-border/60 pt-4 text-[12px] text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        Connection status: organization is set up and reachable from the {shellLabel}.
      </div>
    </div>
  );
}
