"use client";

import React, { useMemo } from "react";
import type { FacilityDetailRow } from "@/types/facility";
import {
  buildOperationalThresholdPreview,
  countFacilityThresholdOverrides,
  countPreviewFiring,
  type OrgDefaultRow,
} from "@/lib/admin/facilities/operational-threshold-preview";
import type { ThresholdRow } from "@/hooks/useFacilityThresholds";
import { formatDistanceToNow } from "date-fns";
import {
  formatThresholdsStripLastChanged,
  thresholdsStripLastChangedIsMissing,
} from "@/lib/facilities/thresholds-tab-display-copy";
import { cn } from "@/lib/utils";

export type FacilityThresholdsStripProps = {
  loading: boolean;
  facility: FacilityDetailRow;
  rows: readonly ThresholdRow[];
  orgDefaults: readonly OrgDefaultRow[];
};

/** KPI strip dedicated to Facility detail → Alert thresholds tab. */
export function FacilityThresholdsMetricsStrip(props: FacilityThresholdsStripProps) {
  const { loading, facility, rows, orgDefaults } = props;

  const firing = useMemo(() => countPreviewFiring(buildOperationalThresholdPreview(facility, rows)), [
    facility,
    rows,
  ]);
  const overrideCount = countFacilityThresholdOverrides(rows, orgDefaults);
  const inheritedCount = rows.length > 0 ? rows.length - overrideCount : 0;
  const activeEnabled = rows.filter((r) => r.enabled).length;

  const lastChanged = useMemo(() => {
    let maxAt = "";
    let maxTs = 0;
    for (const r of rows) {
      const t = Date.parse(r.updated_at);
      if (!Number.isNaN(t) && t >= maxTs) {
        maxTs = t;
        maxAt = r.updated_at;
      }
    }
    return maxAt ? new Date(maxAt) : null;
  }, [rows]);

  const lastChangedMissing = thresholdsStripLastChangedIsMissing(lastChanged);
  const lastChangedLabel = formatThresholdsStripLastChanged(
    lastChanged,
    lastChanged ? formatDistanceToNow(lastChanged, { addSuffix: true }) : "",
  );

  if (loading || rows.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Active thresholds</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
          {activeEnabled}/{rows.length}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">Enabled guardrails</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Currently firing</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{firing.red + firing.yellow}</p>
        <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
          <span className="text-warning">{firing.yellow} yellow</span>
          {" · "}
          <span className="text-destructive">{firing.red} red</span>
        </p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Recently changed</p>
        <p
          className={cn(
            "mt-2 font-semibold leading-snug tabular-nums text-foreground",
            lastChangedMissing ? "text-base text-muted-foreground" : "text-lg",
          )}
        >
          {lastChangedLabel}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">Latest threshold save</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Inherited from org</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
          {inheritedCount}/{rows.length}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{overrideCount} overrides</p>
      </div>
    </div>
  );
}
