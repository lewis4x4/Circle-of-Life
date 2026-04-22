"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShieldAlert, Siren, TrendingDown } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
} from "@/components/common/admin-list-patterns";
import { RiskHubNav } from "@/components/risk/RiskHubNav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiskPageSnapshot, RiskSnapshotRow } from "@/lib/risk/load-risk-command";
import { cn } from "@/lib/utils";

type RiskCommandPageClientProps = {
  initialData: RiskPageSnapshot | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatDelta(delta: number | null) {
  if (delta == null) return "New";
  if (delta === 0) return "Flat";
  return `${delta > 0 ? "+" : ""}${delta}`;
}

function averageScore(rows: RiskSnapshotRow[]) {
  if (rows.length === 0) return null;
  return Math.round(rows.reduce((sum, row) => sum + row.risk_score, 0) / rows.length);
}

function levelTone(level: RiskSnapshotRow["risk_level"]) {
  switch (level) {
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "high":
      return "text-amber-600 dark:text-amber-400";
    case "moderate":
      return "text-indigo-600 dark:text-indigo-400";
    default:
      return "text-emerald-600 dark:text-emerald-400";
  }
}

export default function RiskCommandPageClient({
  initialData,
  initialError,
  initialFacilityId,
}: RiskCommandPageClientProps) {
  const router = useRouter();
  const snapshot: RiskPageSnapshot | null = initialData;
  const error = initialError;
  const scopeFacilityId = initialFacilityId;

  const summary = useMemo(() => {
    if (!snapshot) {
      return {
        portfolioScore: null as number | null,
        criticalFacilities: 0,
        smsSent24h: 0,
        biggestDrop: null as (RiskPageSnapshot["latestRows"][number] | null),
      };
    }

    const portfolioScore = averageScore(snapshot.latestRows);
    const criticalFacilities = snapshot.latestRows.filter((row) => row.risk_level === "critical").length;
    const smsSent24h = snapshot.smsSent24h;
    const biggestDrop = snapshot.latestRows
      .filter((row) => row.score_delta != null && row.score_delta < 0)
      .sort((left, right) => (left.score_delta ?? 0) - (right.score_delta ?? 0))[0] ?? null;

    return { portfolioScore, criticalFacilities, smsSent24h, biggestDrop };
  }, [snapshot]);

  const scopeLabel = useMemo(() => {
    if (!scopeFacilityId) return "Portfolio risk command";
    const scopedFacility = snapshot?.facilities.find((facility) => facility.id === scopeFacilityId);
    return scopedFacility ? `${scopedFacility.name} risk command` : "Facility risk command";
  }, [scopeFacilityId, snapshot?.facilities]);

  return (
    <div className="space-y-6">
      <RiskHubNav />

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">{scopeLabel}</p>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Risk Command</h1>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Nightly cross-domain risk score built from overdue operational work, staffing strain, survey exposure,
              open incidents, and resident safety pressure. High and critical nights route straight to owners.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/executive/alerts">
              Executive alerts
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/risk/survey-bundle">
              Survey bundle
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/operations/overdue">
              Operations overdue
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/compliance">
              Compliance
            </Link>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/incidents">
              Incidents
            </Link>
          </div>
        </div>
      </div>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => router.refresh()} /> : null}

      {snapshot ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={ShieldAlert}
              label="Portfolio score"
              value={summary.portfolioScore != null ? `${summary.portfolioScore}/100` : "—"}
              detail={scopeFacilityId ? "Current facility latest score" : "Average of latest facility snapshots"}
              tone={summary.portfolioScore != null && summary.portfolioScore < 50 ? "red" : summary.portfolioScore != null && summary.portfolioScore < 70 ? "amber" : "emerald"}
            />
            <MetricCard
              icon={Siren}
              label="Critical facilities"
              value={String(summary.criticalFacilities)}
              detail="Latest nightly snapshot in critical range"
              tone={summary.criticalFacilities > 0 ? "red" : "indigo"}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Open risk alerts"
              value={String(snapshot.openAlerts.length)}
              detail="Unresolved executive alerts from the risk command lane"
              tone={snapshot.openAlerts.length > 0 ? "amber" : "emerald"}
            />
            <MetricCard
              icon={TrendingDown}
              label="Owner SMS (24h)"
              value={String(summary.smsSent24h)}
              detail={summary.biggestDrop ? `Largest drop: ${summary.biggestDrop.facilityName} ${formatDelta(summary.biggestDrop.score_delta)}` : "No material overnight declines"}
              tone={summary.smsSent24h > 0 ? "amber" : "indigo"}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <Card>
              <CardHeader>
                <CardTitle>Facility risk ladder</CardTitle>
                <CardDescription>
                  Latest nightly snapshot per facility. Lower scores indicate higher overnight pressure.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {snapshot.latestRows.length === 0 ? (
                  <AdminEmptyState
                    title="No nightly risk scores yet"
                    description="Run the nightly scorer once to populate risk snapshots and owner alert history."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800">
                          <th className="pb-2 pr-4 font-medium">Facility</th>
                          <th className="pb-2 pr-4 font-medium">Score</th>
                          <th className="pb-2 pr-4 font-medium">Level</th>
                          <th className="pb-2 pr-4 font-medium">Delta</th>
                          <th className="pb-2 pr-4 font-medium">Top driver</th>
                          <th className="pb-2 font-medium">Last computed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.latestRows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 dark:border-slate-900">
                            <td className="py-3 pr-4">{row.facilityName}</td>
                            <td className="py-3 pr-4 font-medium">{row.risk_score}/100</td>
                            <td className={cn("py-3 pr-4 capitalize", levelTone(row.risk_level))}>{row.risk_level}</td>
                            <td className={cn("py-3 pr-4", row.score_delta != null && row.score_delta < 0 ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400")}>
                              {formatDelta(row.score_delta)}
                            </td>
                            <td className="py-3 pr-4">
                              {row.topDrivers[0] ? `${row.topDrivers[0].label} (${row.topDrivers[0].count})` : "Stable"}
                            </td>
                            <td className="py-3">{formatDateTime(row.computed_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent owner alert deliveries</CardTitle>
                <CardDescription>
                  Latest outbound notifications from nightly risk scoring. SMS is deduplicated unless the risk tier worsens or drops by 10+ points.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {snapshot.recentDeliveries.length === 0 ? (
                  <AdminEmptyState
                    title="No owner alerts sent"
                    description="Risk alerts will appear here when nightly scoring breaches the high or critical threshold."
                  />
                ) : (
                  snapshot.recentDeliveries.map((delivery) => (
                    <div
                      key={delivery.id}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{delivery.facilityName}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            {delivery.channel} · {delivery.recipient_role}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "text-xs uppercase tracking-[0.18em]",
                            delivery.delivery_status === "sent"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : delivery.delivery_status === "failed"
                                ? "text-red-600 dark:text-red-400"
                                : "text-slate-500 dark:text-slate-400",
                          )}
                        >
                          {delivery.delivery_status}
                        </span>
                      </div>
                      <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                        <p>{delivery.recipient_phone ?? "No phone on file"}</p>
                        <p>{formatDateTime(delivery.sent_at)}</p>
                        {delivery.error_message ? <p className="mt-1 text-red-600 dark:text-red-400">{delivery.error_message}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Current risk alerts</CardTitle>
                <CardDescription>
                  Open executive alerts created by the nightly risk command lane.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {snapshot.openAlerts.length === 0 ? (
                  <AdminEmptyState
                    title="No open risk alerts"
                    description="High and critical facility scores will open executive alerts here until the nightly score stabilizes."
                  />
                ) : (
                  snapshot.openAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <p className="font-medium text-slate-900 dark:text-white">{alert.title}</p>
                      {alert.body ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{alert.body}</p> : null}
                      <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        <span>{alert.severity}</span>
                        <span>{formatDateTime(alert.created_at)}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top overnight drivers</CardTitle>
                <CardDescription>
                  Highest penalty contributors from the latest snapshots. This is what pushed the score down, not a black-box label.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {snapshot.latestRows.length === 0 ? (
                  <AdminEmptyState
                    title="No overnight drivers yet"
                    description="Nightly risk scoring needs at least one completed run before drivers can be ranked."
                  />
                ) : (
                  snapshot.latestRows.slice(0, 4).map((row) => (
                    <div
                      key={row.id}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{row.facilityName}</p>
                          <p className={cn("text-sm capitalize", levelTone(row.risk_level))}>
                            {row.risk_level} · {row.risk_score}/100
                          </p>
                        </div>
                        <Link href="/admin/risk" className="text-sm text-primary underline-offset-4 hover:underline">
                          Open
                        </Link>
                      </div>
                      <div className="mt-3 space-y-2">
                        {row.topDrivers.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400">No dominant risk drivers recorded.</p>
                        ) : (
                          row.topDrivers.map((driver) => (
                            <div key={`${row.id}-${driver.key}`} className="rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-slate-900/70">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-slate-900 dark:text-white">{driver.label}</span>
                                <span className="text-slate-600 dark:text-slate-400">-{driver.penalty}</span>
                              </div>
                              <p className="mt-1 text-slate-600 dark:text-slate-400">{driver.detail}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof ShieldAlert;
  label: string;
  value: string;
  detail: string;
  tone: "indigo" | "emerald" | "amber" | "red";
}) {
  const toneClass =
    tone === "red"
      ? "border-red-200/80 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20"
      : tone === "amber"
        ? "border-amber-200/80 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
        : tone === "emerald"
          ? "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-indigo-200/80 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20";

  return (
    <Card className={toneClass}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{detail}</p>
        </div>
        <div className="rounded-xl border border-white/50 bg-white/70 p-3 text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
