"use client";

import React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import {
  formatStaffStripCoverageGapMainValue,
  staffStripCoverageGapMainIsNotTracked,
  staffStripCoverageGapMainIsNumeric,
} from "@/lib/facilities/staff-metrics-strip-display-copy";
import type { FacilityStaffKpiPayload } from "@/hooks/useFacilityStaffKpis";
import type { FacilityDetailRow } from "@/types/facility";

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

export function FacilityStaffMetricsStrip(props: {
  facility: FacilityDetailRow;
  loading: boolean;
  kpi: FacilityStaffKpiPayload | null;
  kpiError: string | null;
}) {
  const { facility, loading, kpi, kpiError } = props;

  if (loading || !kpi) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[122px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
        ))}
      </div>
    );
  }

  const ratioReady = Boolean(facility.facility_ratio_rule_set_id);
  const coverageGapMainValue = formatStaffStripCoverageGapMainValue(
    ratioReady,
    kpi.coverageGapNext7Days,
  );
  const coverageGapMainIsNotTracked = staffStripCoverageGapMainIsNotTracked(coverageGapMainValue);
  const coverageGapMainIsNumeric = staffStripCoverageGapMainIsNumeric(coverageGapMainValue);

  const coverageGapMain = coverageGapMainIsNotTracked ? (
    <span className="text-lg font-semibold text-warning">{coverageGapMainValue}</span>
  ) : (
    coverageGapMainValue
  );

  const coverageGapSub = ratioReady ? (
    <span>Coverage engine — launching sprint</span>
  ) : (
    <span>
      Configure a ratio rule set to compute shift coverage vs Rule 59A-36 —{" "}
      <Link href="/admin/staffing" className="font-medium text-foreground underline-offset-4 hover:underline">
        Configure →
      </Link>
    </span>
  );

  const certsLine = `${kpi.certsCurrent} / ${kpi.certsExpiring} / ${kpi.certsExpired}`;
  const bgLine = kpi.bgChecksExpiringLt30;

  return (
    <div className="space-y-3">
      {kpiError ? (
        <p className="text-[12px] text-destructive" role="alert">
          {kpiError}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StripTile label="Active staff" value={kpi.activeStaff} sub="Live roster · Workforce module" />
        <StripTile
          label="Coverage gap (next 7 days)"
          value={coverageGapMain}
          sub={coverageGapSub}
          valueClassName={
            !coverageGapMainIsNotTracked && !coverageGapMainIsNumeric
              ? "text-lg text-muted-foreground"
              : undefined
          }
        />
        <StripTile
          label="Certifications"
          value={<span className="text-2xl tabular-nums">{certsLine}</span>}
          sub="Current / expiring / expired (facility scope)"
        />
        <StripTile
          label="Background checks expiring <30 days"
          value={bgLine}
          sub={bgLine > 0 ? "Renew before lapse" : "No expiring checks in window"}
          valueClassName={bgLine > 0 ? "text-warning" : undefined}
        />
      </div>
    </div>
  );
}
