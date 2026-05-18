"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { FacilityTab } from "@/lib/admin/facilities/facility-constants";
import { FACILITY_TAB_LABELS } from "@/lib/admin/facilities/facility-constants";

function StripTile({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-[8px] border border-border bg-muted/10 p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className={cn("mt-2 text-3xl font-semibold tabular-nums text-foreground leading-tight", valueClassName)}>
        {value}
      </div>
      {sub ? <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

const SECONDARY_BLURBS: Partial<
  Record<
    FacilityTab,
    {
      a: string;
      b: string;
      c: string;
    }
  >
> = {
  documents: {
    a: "Pending legal review",
    b: "Expiring attestations",
    c: "Vault folders open",
  },
  staffing: {
    a: "Open ratio exceptions",
    b: "Config exports",
    c: "Last workforce sync",
  },
  thresholds: {
    a: "Overrides active",
    b: "Rules missing owner",
    c: "Last evaluator run",
  },
  audit: {
    a: "Immutable events",
    b: "Anomalies surfaced",
    c: "Last export",
  },
  timeline: {
    a: "Events this week",
    b: "Unacknowledged deltas",
    c: "Source feed health",
  },
};

/**
 * Prevents leakage of Overview KPIs (open incidents / labor MTD / survey readiness tiles)
 * for facility tabs that lack their own KPI feed yet — keeps placeholders honest instead.
 */
export function FacilitySecondaryTabMetricsStrip({
  tab,
}: {
  tab: FacilityTab;
}) {
  const blurbs =
    SECONDARY_BLURBS[tab] ??
    ({
      a: "Open items",
      b: "Owner actions",
      c: "Last sync signal",
    } as const);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StripTile
        label={`${FACILITY_TAB_LABELS[tab]} workspace`}
        value="Focused"
        sub="Overview KPIs stay on Overview tab · detailed metrics render below tabs."
      />
      <StripTile label={blurbs.a} value="—" sub="See tab grid" valueClassName="text-2xl text-muted-foreground" />
      <StripTile label={blurbs.b} value="—" sub="See tab grid" valueClassName="text-2xl text-muted-foreground" />
      <StripTile label={blurbs.c} value="—" sub="See tab grid" valueClassName="text-2xl text-muted-foreground" />
    </div>
  );
}
