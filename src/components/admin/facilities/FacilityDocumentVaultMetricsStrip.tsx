"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { DocumentVaultKpiPayload } from "@/lib/admin/facilities/document-vault-kpi";

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

export function FacilityDocumentVaultMetricsStrip(props: {
  loading: boolean;
  kpi: DocumentVaultKpiPayload | null;
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

  const { total, expiringLt60, expired, missingRequired } = props.kpi;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StripTile label="Total documents" value={total} sub="Facility-scoped vault" />
      <StripTile
        label="Expiring < 60 days"
        value={expiringLt60}
        sub="Time-bound renewals coming due"
        valueClassName={expiringLt60 > 0 ? "text-warning" : undefined}
      />
      <StripTile
        label="Expired"
        value={expired}
        sub={expired > 0 ? "Replace or renew evidence" : "No expired vault items"}
        valueClassName={expired > 0 ? "text-destructive" : undefined}
      />
      <StripTile
        label="Missing required categories"
        value={missingRequired}
        sub={missingRequired > 0 ? "Core compliance slots open" : "Required category coverage OK"}
        valueClassName={missingRequired > 0 ? "text-warning" : undefined}
      />
    </div>
  );
}
