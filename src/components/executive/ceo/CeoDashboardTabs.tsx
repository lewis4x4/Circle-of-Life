"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Brain } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CeoAlertDisplay } from "@/lib/executive/load-ceo-dashboard-data";

function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-border bg-card p-6 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({
  children,
  sub,
}: {
  children: ReactNode;
  sub?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-card-foreground">{children}</h3>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function EmptyLiveSourcePanel({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <Panel className="flex min-h-[300px] items-center justify-center">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-lg font-semibold text-card-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </Panel>
  );
}

function EmptyAlertsState() {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm font-semibold text-foreground">No live CEO alerts</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Executive alerts will appear here after the live alert source returns rows.
      </p>
    </div>
  );
}

export default function CeoDashboardTabs({
  tab,
  displayAlerts,
}: {
  tab: string;
  displayAlerts: CeoAlertDisplay[];
}) {
  if (tab === "Alerts") {
    return (
      <Panel>
        <SectionTitle sub="Executive-level alerts requiring leadership attention">
          Active Alerts & Escalations
        </SectionTitle>
        {displayAlerts.length === 0 ? (
          <EmptyAlertsState />
        ) : (
          <div className="space-y-2">
            {displayAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 rounded-[var(--radius)] px-4 py-3 transition-colors duration-[var(--motion-duration-micro)] hover:bg-muted/20"
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    alert.severity === "critical"
                      ? "bg-destructive/10"
                      : alert.severity === "warning"
                        ? "bg-warning/10"
                        : "bg-info/10",
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4",
                      alert.severity === "critical"
                        ? "text-destructive"
                        : alert.severity === "warning"
                          ? "text-warning"
                          : "text-info",
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-card-foreground">{alert.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{alert.description}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {alert.facility} · {alert.age}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                    alert.severity === "critical"
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : alert.severity === "warning"
                        ? "border-warning/30 bg-warning/10 text-warning"
                        : "border-info/30 bg-info/10 text-info",
                  )}
                >
                  {alert.severity}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  if (tab === "Reports") {
    return (
      <EmptyLiveSourcePanel
        title="Live CEO reports source is not loaded"
        detail="Portfolio trend charts and facility scorecards stay empty until real census, billing, incident, staffing, and survey sources are connected. No fallback report rows are shown."
      />
    );
  }

  if (tab === "Benchmarks") {
    return (
      <EmptyLiveSourcePanel
        title="Live benchmark source is not loaded"
        detail="Benchmark comparisons require a real benchmark dataset and live portfolio rollups. No hard-coded Haven or industry averages are shown."
      />
    );
  }

  if (tab === "Haven Insight") {
    return (
      <Panel className="flex min-h-[300px] items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[var(--radius)] border border-border bg-muted/40">
            <Brain className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-lg font-semibold text-card-foreground">Haven Insight</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Ask questions about your portfolio in plain English and get AI-powered answers from your live data.
          </p>
          <Link
            href="/admin/executive/nlq"
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition-all duration-[var(--motion-duration)] hover:opacity-90"
          >
            <Brain className="h-4 w-4" /> Open Haven Insight
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <EmptyLiveSourcePanel
      title="Live CEO detail source is not loaded"
      detail="Growth funnel and risk-index panels stay empty until real admissions, reputation, incident, and portfolio analytics sources are connected. No fallback chart data is shown."
    />
  );
}
