"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { headCountOrNull } from "@/lib/metrics/head-count";
import { createClient } from "@/lib/supabase/client";
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
  /** When given, the visitor tile counts who is signed in right now (COL-871). */
  facilityId?: string;
};

/** Visitors signed in at this building and not signed out; null when the read fails. */
function useVisitorsInBuilding(facilityId: string | undefined): { loading: boolean; count: number | null } {
  const [state, setState] = useState<{ loading: boolean; count: number | null }>({ loading: Boolean(facilityId), count: null });
  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    void (async () => {
      const reply = await createClient()
        .from("visitor_log_entries" as never)
        .select("id", { count: "exact", head: true })
        .eq("facility_id", facilityId)
        .is("checked_out_at", null)
        .is("voided_at", null)
        .is("deleted_at", null);
      if (!cancelled) setState({ loading: false, count: headCountOrNull(reply) });
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId]);
  return state;
}

/**
 * Communications & Policy tab — contextual tiles (notification/visitor telemetry may be wired later).
 */
export function FacilityCommunicationMetricsStrip({ loading, settings, facilityId }: FacilityCommunicationMetricsStripProps) {
  const visitors = useVisitorsInBuilding(facilityId);
  const health = resolveCommunicationStripOnlineListingHealth(settings, loading);
  const healthResolved = communicationStripListingHealthIsResolved(health);
  const lastFamilyNotification = formatCommunicationStripLastFamilyNotification(loading);
  const visitorsLoading = facilityId ? visitors.loading : loading;
  const openVisitorSessions = formatCommunicationStripOpenVisitorSessions(visitorsLoading, facilityId ? visitors.count : null);
  const visitorCountShown = !visitorsLoading && facilityId !== undefined && visitors.count !== null;
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
        label="Visitors in the building now"
        value={openVisitorSessions}
        sub={
          visitorsLoading ? (
            "…"
          ) : (
            <Link href="/admin/front-desk" prefetch={false} className="underline underline-offset-2 hover:text-foreground">
              Open the front desk
            </Link>
          )
        }
        valueClassName={
          visitorsLoading ? "text-2xl text-muted-foreground animate-pulse" : visitorCountShown ? undefined : "text-2xl text-muted-foreground"
        }
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
