"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight, Brain } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminOperationalListPanel,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { buttonVariants } from "@/components/ui/button";
import type { ExecutiveAlertRow } from "@/lib/exec-alerts";
import {
  formatExecutiveOfficerCountLabel,
  formatExecutiveOfficerKpiValue,
  formatExecutiveRelativeAge,
} from "@/lib/executive/executive-display-copy";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the executive role dashboards (CEO / CFO / COO).
 *
 * Single source of truth so all three officers read as one app: the app's
 * design system (not the moonshot theme), a dark readable header, uppercase
 * KPI tiles, deep-linking priority lanes, and a live exec_alerts watchlist
 * with real loading / empty / error states. Mirrors ExecutiveOverviewPageClient.
 */

export type OfficerKpiTone = "neutral" | "warning" | "danger";

export function OfficerHeader({
  title,
  subtitle,
  backHref = "/admin/executive",
}: {
  title: string;
  subtitle: string;
  backHref?: string;
}) {
  return (
    <header className="px-6 pt-8 sm:px-12">
      <div className="flex flex-col gap-1 border-b border-border pb-6">
        <Link
          href={backHref}
          className="mb-2 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Executive Overview
        </Link>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  );
}

/** Executive-Overview-style KPI tile: uppercase label + dominant value, tone on value only. */
export function OfficerKpiTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: OfficerKpiTone;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function OfficerKpiStrip({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

export type OfficerLane = { stat: string; title: string; description: string; href: string };

export function OfficerLanes({
  heading = "Operational lanes",
  subheading,
  lanes,
}: {
  heading?: string;
  subheading?: string;
  lanes: OfficerLane[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">{heading}</h2>
        {subheading ? <p className="mt-0.5 text-[12px] text-muted-foreground">{subheading}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {lanes.map((lane) => (
          <Link
            key={lane.title}
            prefetch={false}
            href={lane.href}
            className={cn(
              "group flex flex-col gap-2 rounded-lg border border-border bg-card p-4",
              "transition-colors hover:bg-secondary/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{lane.stat}</span>
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">{lane.title}</h3>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{lane.description}</p>
            <span className="mt-auto inline-flex items-center gap-1 text-[12px] font-medium text-foreground transition-colors group-hover:text-foreground/80">
              Open lane <ArrowRight className="size-3" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function severityTone(severity: string): StatusPillTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function relativeAge(iso: string | null): string {
  return formatExecutiveRelativeAge(iso);
}

/** Live exec_alerts watchlist with real loading / empty / error states. */
export function OfficerAlertsPanel({
  heading = "Operational alerts",
  emptyTitle = "No open alerts",
  emptyDescription = "Escalations and exception alerts across your facilities will appear here as they trigger.",
  alerts,
  facilityNameById,
  loading,
  error,
  onRetry,
}: {
  heading?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  alerts: ExecutiveAlertRow[];
  facilityNameById: Map<string, string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
          <AlertTriangle className="size-4 text-warning" aria-hidden /> {heading}
        </h2>
        {!loading && !error ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={onRetry} />
      ) : alerts.length === 0 ? (
        <AdminEmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <AdminOperationalListPanel>
          <div className="divide-y divide-border">
            {alerts.map((alert) => {
              const facilityName = alert.facility_id
                ? facilityNameById.get(alert.facility_id) ?? "Facility"
                : "Enterprise";
              return (
                <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                  <StatusPill tone={severityTone(alert.severity)} className="mt-0.5 shrink-0">
                    {alert.severity}
                  </StatusPill>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">{alert.title}</p>
                    {alert.body ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{alert.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {alert.category ?? "operations"} · {facilityName} ·{" "}
                      {relativeAge(alert.first_triggered_at ?? alert.created_at)}
                    </p>
                  </div>
                  {alert.deep_link_path ? (
                    <Link
                      prefetch={false}
                      href={alert.deep_link_path}
                      className="shrink-0 text-[12px] font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </AdminOperationalListPanel>
      )}
    </section>
  );
}

export function HavenInsightPanel({ domain = "operations" }: { domain?: string }) {
  return (
    <AdminOperationalListPanel>
      <div className="flex flex-col items-start gap-3 px-4 py-6">
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
          <Brain className="size-4 text-muted-foreground" aria-hidden /> Haven Insight
        </h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Ask questions about live {domain} data in natural language.
        </p>
        <Link prefetch={false} href="/admin/executive/nlq" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
          <Brain className="size-4" aria-hidden /> Open Haven Insight
        </Link>
      </div>
    </AdminOperationalListPanel>
  );
}

/** Panel for a tab whose full experience already lives on a dedicated page. */
export function OfficerLinkOutPanel({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <AdminOperationalListPanel>
      <div className="flex flex-col items-start gap-3 px-4 py-6">
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        <Link prefetch={false} href={href} className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
          {cta} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </AdminOperationalListPanel>
  );
}

/** Quiet note when a role board exposes fewer pills than the full nav catalog. */
export function OfficerLiveViewsNotice({ count }: { count: number }) {
  const label = count === 1 ? "view" : "views";
  return (
    <p className="text-[12px] text-muted-foreground" data-testid="officer-live-views-notice">
      {count} live {label} on this board
    </p>
  );
}

/** id → name map for resolving an alert's facility. */
export function useFacilityNameMap(facilities: Array<{ id: string; name: string }>): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const facility of facilities) map.set(facility.id, facility.name);
    return map;
  }, [facilities]);
}

/** "3 overdue" / "No overdue posted" helper for lane stat lines. */
export function officerCountLabel(value: number | undefined, noun: string): string {
  return formatExecutiveOfficerCountLabel(value, noun);
}

/** Tile value string: loading placeholder, named gap, or the number. */
export function officerKpiValue(value: number | undefined, loading: boolean, metricLabel: string): string {
  return formatExecutiveOfficerKpiValue(value, loading, metricLabel);
}

/** Danger/warning tone only when an alarm count is > 0 (0-guard). */
export function officerAlarmTone(value: number | undefined, tone: OfficerKpiTone): OfficerKpiTone {
  return value != null && value > 0 ? tone : "neutral";
}
