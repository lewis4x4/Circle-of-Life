"use client";

import React from "react";
import { cn } from "@/lib/utils";

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

function formatNyDateTime(iso: unknown): string {
  if (typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function onlineListingHealth(settings: Record<string, unknown> | null): { value: string; sub: string; warn?: boolean } {
  if (!settings) {
    return { value: "—", sub: "Loading profile" };
  }
  const g = String(settings.google_business_profile_url ?? "").trim();
  const y = String(settings.yelp_listing_url ?? "").trim();
  if (g && y) return { value: "Linked", sub: "Google + Yelp on file" };
  if (g) return { value: "Partial", sub: "Google only — add Yelp" };
  if (y) return { value: "Partial", sub: "Yelp only — add Google" };
  return { value: "Review needed", sub: "No listing URLs on file", warn: true };
}

export type FacilityCommunicationMetricsStripProps = {
  loading: boolean;
  settings: Record<string, unknown> | null;
};

/**
 * Communications & Policy tab — contextual tiles (notification/visitor telemetry may be wired later).
 */
export function FacilityCommunicationMetricsStrip({ loading, settings }: FacilityCommunicationMetricsStripProps) {
  const health = onlineListingHealth(settings);
  const lastChange = loading ? "—" : formatNyDateTime(settings?.updated_at);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StripTile
        label="Last family notification sent"
        value={loading ? "—" : "—"}
        sub={loading ? "…" : "Notification telemetry pending"}
        valueClassName={loading ? "text-2xl text-muted-foreground animate-pulse" : "text-2xl text-muted-foreground"}
      />
      <StripTile
        label="Open visitor sessions"
        value={loading ? "—" : "—"}
        sub={loading ? "…" : "Visitor session tracking pending"}
        valueClassName={loading ? "text-2xl text-muted-foreground animate-pulse" : "text-2xl text-muted-foreground"}
      />
      <StripTile
        label="Online listing health"
        value={loading ? "—" : health.value}
        sub={loading ? "…" : health.sub}
        valueClassName={cn(
          loading && "text-2xl text-muted-foreground animate-pulse",
          !loading && health.warn && "text-2xl text-warning",
          !loading && !health.warn && health.value !== "—" && "text-2xl",
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
