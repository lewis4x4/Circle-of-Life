"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  communicationStripListingHealthIsResolved,
  formatCommunicationStripLastChange,
  formatCommunicationStripLastFamilyNotification,
  formatCommunicationStripOpenVisitorSessions,
  resolveCommunicationStripOnlineListingHealth,
} from "@/lib/facilities/communication-metrics-strip-display-copy";

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
      <div
        className={cn("mt-2 text-3xl font-semibold tabular-nums text-foreground leading-tight", valueClassName)}
      >
        {value}
      </div>
      {sub ? <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export type FacilityCommunicationMetricsStripProps = {
  loading: boolean;
  settings: Record<string, unknown> | null;
};

/**
 * Communications & Policy tab — contextual tiles (notification/visitor telemetry may be wired later).
 */
export function FacilityCommunicationMetricsStrip({ loading, settings }: FacilityCommunicationMetricsStripProps) {
  const health = resolveCommunicationStripOnlineListingHealth(settings, loading);
  const healthResolved = communicationStripListingHealthIsResolved(health);
  const lastFamilyNotification = formatCommunicationStripLastFamilyNotification(loading);
  const openVisitorSessions = formatCommunicationStripOpenVisitorSessions(loading);
  const lastChange = formatCommunicationStripLastChange(settings?.updated_at, loading);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StripTile
        label="Last family notification sent"
        value={lastFamilyNotification}
        sub={loading ? "…" : "Notification telemetry pending"}
        valueClassName={loading ? "text-2xl text-muted-foreground animate-pulse" : "text-2xl text-muted-foreground"}
      />
      <StripTile
        label="Open visitor sessions"
        value={openVisitorSessions}
        sub={loading ? "…" : "Visitor session tracking pending"}
        valueClassName={loading ? "text-2xl text-muted-foreground animate-pulse" : "text-2xl text-muted-foreground"}
      />
      <StripTile
        label="Online listing health"
        value={health.value}
        sub={loading ? "…" : health.sub}
        valueClassName={cn(
          loading && "text-2xl text-muted-foreground animate-pulse",
          !loading && health.warn && "text-2xl text-warning",
          !loading && !health.warn && healthResolved && "text-2xl",
        )}
      />
      <StripTile
        label="Last settings change"
        value={lastChange}
        sub={loading ? "…" : "Facility communication record"}
        valueClassName={loading ? "text-2xl text-muted-foreground animate-pulse" : "text-xl sm:text-2xl"}
      />
    </div>
  );
}
