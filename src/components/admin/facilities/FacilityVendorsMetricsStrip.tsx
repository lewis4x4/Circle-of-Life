"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  formatVendorsStripCoiCurrentDisplay,
  formatVendorsStripContractsExpiringDisplay,
  vendorsStripCoiCurrentIsMissing,
  vendorsStripContractsExpiringIsMissing,
} from "@/lib/facilities/vendors-strip-display-copy";

export type FacilityVendorStripKpi = {
  canonical_vendor_count: number;
  migration_residue_count: number;
};

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

/**
 * KPI strip for Facility detail vendors tab (`?tab=vendors`).
 * Counts derive from canonical `vendor_facilities` joins plus Facility Launch placeholders.
 */
export function FacilityVendorsMetricsStrip(props: {
  loading: boolean;
  kpi: FacilityVendorStripKpi | null;
  complianceGapCount: number;
}) {
  if (props.loading || !props.kpi) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[122px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
        ))}
      </div>
    );
  }

  const { canonical_vendor_count, migration_residue_count } = props.kpi;
  const residueSub =
    migration_residue_count > 0
      ? `${migration_residue_count} imported row${migration_residue_count === 1 ? "" : "s"} need cleanup`
      : "No launch-import placeholders";

  /** Not wired until `vendor_facilities.coi_*` schema lands. */
  const coiCurrentCount: number | undefined = undefined;
  /** Not wired until vendor contracts backlog is tied in. */
  const contractsExpiringCount: number | undefined = undefined;

  const coiCurrentDisplay = formatVendorsStripCoiCurrentDisplay(coiCurrentCount);
  const contractsExpiringDisplay = formatVendorsStripContractsExpiringDisplay(contractsExpiringCount);
  const coiCurrentMissing = vendorsStripCoiCurrentIsMissing(coiCurrentCount);
  const contractsExpiringMissing = vendorsStripContractsExpiringIsMissing(contractsExpiringCount);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StripTile label="Total vendors linked" value={canonical_vendor_count} sub={residueSub} />

      <StripTile
        label="COIs current"
        value={coiCurrentDisplay}
        sub="Expired · schema wiring pending (`vendor_facilities.coi_*`)"
        valueClassName={coiCurrentMissing ? "text-2xl text-muted-foreground" : undefined}
      />

      <StripTile
        label="Contracts expiring (next 90 days)"
        value={contractsExpiringDisplay}
        sub="Tie-in to vendor contracts backlog"
        valueClassName={contractsExpiringMissing ? "text-2xl text-muted-foreground" : undefined}
      />

      <StripTile
        label="Required vendor categories open"
        value={props.complianceGapCount}
        sub={
          props.complianceGapCount > 0 ? (
            <Link href="#facility-required-vendor-categories" className="font-medium text-primary underline-offset-4 hover:underline">
              Review checklist →
            </Link>
          ) : (
            "FL ALF checklist satisfied on linked surface"
          )
        }
        valueClassName={props.complianceGapCount > 0 ? "text-warning text-3xl font-semibold" : undefined}
      />
    </div>
  );
}
