"use client";

import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FacilityAuditMetricsPayload } from "@/hooks/useFacilityAuditMetrics";
import { formatDistanceToNow } from "date-fns";
import {
  AUDIT_STRIP_NO_TOP_USER_COPY,
  auditStripLastEventIsMissing,
  formatAuditStripLastEventRelative,
  formatAuditStripTopUserDisplay,
} from "@/lib/facilities/audit-tab-display-copy";

interface FacilityAuditMetricsStripProps {
  loading: boolean;
  metrics: FacilityAuditMetricsPayload | null;
  retentionCopy: string;
}

export function FacilityAuditMetricsStrip({ loading, metrics, retentionCopy }: FacilityAuditMetricsStripProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
        ))}
      </div>
    );
  }

  const last = metrics?.last_event_at != null ? new Date(metrics.last_event_at) : null;
  const lastMissing = auditStripLastEventIsMissing(last);
  const relative = formatAuditStripLastEventRelative(
    last,
    last != null && !Number.isNaN(last.getTime()) ? `${formatDistanceToNow(last)} ago` : "",
  );
  const eventsLast7d = metrics?.events_last_7d ?? 0;
  const topUserLabel = formatAuditStripTopUserDisplay(metrics?.top_user_display, eventsLast7d);
  const topUserMissing = topUserLabel === AUDIT_STRIP_NO_TOP_USER_COPY;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Events last 7 days</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{metrics?.events_last_7d ?? 0}</p>
      </div>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="h-auto min-h-[112px] w-full rounded-[8px] border border-border bg-muted/10 p-5 text-left transition-colors hover:bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-[13px] text-muted-foreground">Retention period</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
            {metrics?.retention_years ?? 7} yr
          </p>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-left text-xs leading-snug">{retentionCopy}</TooltipContent>
      </Tooltip>
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Most active user (7d)</p>
        <p className="mt-2 line-clamp-2 text-xl font-semibold leading-snug text-foreground">
          <span className={topUserMissing ? "text-lg text-muted-foreground" : undefined}>{topUserLabel}</span>
        </p>
      </div>
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Last event</p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums text-foreground",
            lastMissing ? "text-lg leading-snug text-muted-foreground" : "text-xl",
          )}
        >
          {relative}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">Facility-scoped immutable trail</p>
      </div>
    </div>
  );
}
