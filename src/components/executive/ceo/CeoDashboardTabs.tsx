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
        "rounded-2xl border border-white/5 bg-slate-900/50 p-6 shadow-lg backdrop-blur",
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
      <h3 className="text-sm font-semibold text-white">{children}</h3>
      {sub ? <p className="mt-1 text-xs text-slate-400">{sub}</p> : null}
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
        <p className="text-lg font-semibold text-white">{title}</p>
        <p className="text-sm text-slate-400">{detail}</p>
      </div>
    </Panel>
  );
}

function EmptyAlertsState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-white">No live CEO alerts</p>
      <p className="mt-2 text-xs text-slate-400">
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
                className="flex items-start gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-white/[0.02]"
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    alert.severity === "critical"
                      ? "bg-rose-500/20"
                      : alert.severity === "warning"
                        ? "bg-amber-500/20"
                        : "bg-sky-500/20",
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4",
                      alert.severity === "critical"
                        ? "text-rose-400"
                        : alert.severity === "warning"
                          ? "text-amber-400"
                          : "text-sky-400",
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{alert.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{alert.description}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {alert.facility} · {alert.age}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border border-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                    alert.severity === "critical"
                      ? "bg-rose-500/20 text-rose-400"
                      : alert.severity === "warning"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-sky-500/20 text-sky-400",
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
        detail="Portfolio trend charts and facility scorecards stay empty until real census, billing, incident, staffing, and survey sources are connected. No seeded report rows are shown."
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
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/20 to-indigo-600/20">
            <Brain className="h-7 w-7 text-violet-400" />
          </div>
          <p className="text-lg font-semibold text-white">Haven Insight</p>
          <p className="mx-auto max-w-md text-sm text-slate-400">
            Ask questions about your portfolio in plain English and get AI-powered answers from your live data.
          </p>
          <Link
            href="/admin/executive/nlq"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500"
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
      detail="Growth funnel and risk-index panels stay empty until real admissions, reputation, incident, and portfolio analytics sources are connected. No seeded chart data is shown."
    />
  );
}
