"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ShieldCheck, ShieldAlert, Sparkles, Table2 } from "lucide-react";

import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadBlobFromUrl } from "@/lib/download-blob";
import type { BoardPacketSummary, LeagueFacilityRow } from "@/lib/executive/league";
import type { ExecutiveLeagueData } from "@/lib/executive/load-league-data";
import { formatCents } from "@/lib/finance/format-cents";

type ExecutiveLeaguePageClientProps = {
  initialData: ExecutiveLeagueData | null;
  initialError: string | null;
};

function downloadLeagueCsv(rows: LeagueFacilityRow[]) {
  const header = [
    "Facility",
    "Entity",
    "League Score",
    "League Label",
    "Risk Score",
    "Risk Level",
    "Occupancy Pct",
    "Open Invoices",
    "Balance Due Cents",
    "Insurance Score",
    "Primary Concern",
  ];
  const body = rows.map((row) => [
    row.facilityName,
    row.entityName,
    String(row.leagueScore),
    row.leagueLabel,
    row.riskScore == null ? "" : String(row.riskScore),
    row.riskLevel ?? "",
    row.occupancyPct == null ? "" : String(row.occupancyPct),
    String(row.openInvoicesCount),
    String(row.totalBalanceDueCents),
    String(row.insuranceScore),
    row.primaryConcern,
  ]);

  const csv = [header, ...body]
    .map((line) =>
      line
        .map((cell) => {
          if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
          return cell;
        })
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `executive-league-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ExecutiveLeaguePageClient({
  initialData,
  initialError,
}: ExecutiveLeaguePageClientProps) {
  const router = useRouter();
  const rows = useMemo(() => initialData?.rows ?? [], [initialData]);
  const insuranceRows = useMemo(() => initialData?.insuranceRows ?? [], [initialData]);
  const boardSummary: BoardPacketSummary = initialData?.boardSummary ?? {
    weekOf: null,
    status: null,
    confidenceBand: null,
    completenessPct: null,
    publishedVersion: null,
    publishedAt: null,
    savedPacketCount: 0,
    lastSavedAt: null,
  };
  const error = initialError;

  const summary = useMemo(() => {
    if (rows.length === 0) {
      return {
        averageLeagueScore: null as number | null,
        watchFacilities: 0,
        leadingFacility: null as LeagueFacilityRow | null,
        insuranceReadyEntities: 0,
      };
    }
    return {
      averageLeagueScore: Math.round(rows.reduce((sum, row) => sum + row.leagueScore, 0) / rows.length),
      watchFacilities: rows.filter((row) => row.leagueLabel === "watch" || row.leagueLabel === "critical").length,
      leadingFacility: rows[0] ?? null,
      insuranceReadyEntities: insuranceRows.filter((row) => row.readinessLabel === "ready").length,
    };
  }, [rows, insuranceRows]);

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Portfolio-wide league table and board handoff
          </p>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Executive league</h1>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Rank facilities with one board-facing score that blends operational risk, financial pressure, occupancy,
              and insurance readiness. This route is portfolio-wide by design and feeds board-pack conversations.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            onClick={() => void downloadBlobFromUrl("/api/executive/league/pdf", "executive-league.pdf")}
            disabled={rows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            League PDF
          </button>
          <button
            type="button"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            onClick={() => downloadLeagueCsv(rows)}
            disabled={rows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            League CSV
          </button>
          {boardSummary.weekOf ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/admin/executive/standup/${encodeURIComponent(boardSummary.weekOf)}/board`}
            >
              Latest board packet
            </Link>
          ) : null}
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/executive/reports">
            Executive reports
          </Link>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/insurance/renewal-packages">
            Insurance readiness
          </Link>
        </div>
      </div>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => router.refresh()} /> : null}

      {rows.length > 0 ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <LeagueMetricCard
              icon={Sparkles}
              label="Portfolio average"
              value={summary.averageLeagueScore != null ? `${summary.averageLeagueScore}/100` : "—"}
              detail={summary.leadingFacility ? `Leader: ${summary.leadingFacility.facilityName}` : "No facility rows"}
              tone={summary.averageLeagueScore != null && summary.averageLeagueScore >= 80 ? "emerald" : "indigo"}
            />
            <LeagueMetricCard
              icon={ShieldAlert}
              label="Watch facilities"
              value={String(summary.watchFacilities)}
              detail="Facilities in watch or critical board posture"
              tone={summary.watchFacilities > 0 ? "amber" : "emerald"}
            />
            <LeagueMetricCard
              icon={ShieldCheck}
              label="Insurance-ready entities"
              value={`${summary.insuranceReadyEntities}/${insuranceRows.length}`}
              detail="Entities with a current packet and no active readiness flags"
              tone={summary.insuranceReadyEntities === insuranceRows.length ? "emerald" : "indigo"}
            />
            <LeagueMetricCard
              icon={Table2}
              label="Board packet"
              value={boardSummary.weekOf ?? "None"}
              detail={
                boardSummary.weekOf
                  ? `${boardSummary.confidenceBand ?? "n/a"} confidence · ${Math.round(boardSummary.completenessPct ?? 0)}% complete`
                  : "No published standup packet yet"
              }
              tone={boardSummary.weekOf ? "indigo" : "amber"}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Facility league table</CardTitle>
                <CardDescription>
                  Higher league scores indicate stronger board-readiness. Ranking blends nightly risk, occupancy, AR pressure, and entity insurance readiness.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="pb-2 pr-4 font-medium">Facility</th>
                      <th className="pb-2 pr-4 font-medium">League</th>
                      <th className="pb-2 pr-4 font-medium">Risk</th>
                      <th className="pb-2 pr-4 font-medium">Occupancy</th>
                      <th className="pb-2 pr-4 font-medium">Open AR</th>
                      <th className="pb-2 pr-4 font-medium">Insurance</th>
                      <th className="pb-2 font-medium">Board note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.facilityId} className="border-b border-slate-100 dark:border-slate-900">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-slate-900 dark:text-white">{row.facilityName}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{row.entityName}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="font-semibold">{row.leagueScore}/100</div>
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{row.leagueLabel}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div>{row.riskScore != null ? `${row.riskScore}/100` : "—"}</div>
                          <div className="text-xs capitalize text-slate-500 dark:text-slate-400">{row.riskLevel ?? "no nightly score"}</div>
                        </td>
                        <td className="py-3 pr-4">{row.occupancyPct != null ? `${row.occupancyPct}%` : "—"}</td>
                        <td className="py-3 pr-4">
                          <div>{formatCents(row.totalBalanceDueCents)}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{row.openInvoicesCount} open invoice(s)</div>
                        </td>
                        <td className="py-3 pr-4">{row.insuranceScore}/100</td>
                        <td className="py-3">
                          <div className="text-sm text-slate-700 dark:text-slate-300">{row.primaryConcern}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.boardNote}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Board packet readiness</CardTitle>
                <CardDescription>
                  Current publish state of the weekly standup board packet and the saved board-report inventory.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <LeagueValue label="Published week" value={boardSummary.weekOf ?? "Not published"} />
                <LeagueValue label="Packet status" value={boardSummary.status ?? "—"} />
                <LeagueValue label="Confidence" value={boardSummary.confidenceBand ?? "—"} />
                <LeagueValue
                  label="Completeness"
                  value={boardSummary.completenessPct != null ? `${Math.round(boardSummary.completenessPct)}%` : "—"}
                />
                <LeagueValue label="Saved board packets" value={String(boardSummary.savedPacketCount)} />
                <LeagueValue label="Last saved" value={boardSummary.lastSavedAt ? new Date(boardSummary.lastSavedAt).toLocaleString() : "—"} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Insurance readiness by entity</CardTitle>
              <CardDescription>
                Renewal posture summarized once per legal entity so board review can see packet freshness and expiring coverage without bouncing into the insurance hub.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="pb-2 pr-4 font-medium">Entity</th>
                    <th className="pb-2 pr-4 font-medium">Readiness</th>
                    <th className="pb-2 pr-4 font-medium">Active policies</th>
                    <th className="pb-2 pr-4 font-medium">Expiring 60d</th>
                    <th className="pb-2 pr-4 font-medium">Renewals open</th>
                    <th className="pb-2 pr-4 font-medium">Latest packet</th>
                    <th className="pb-2 font-medium">Concern</th>
                  </tr>
                </thead>
                <tbody>
                  {insuranceRows.map((row) => (
                    <tr key={row.entityId} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-3 pr-4">{row.entityName}</td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{row.readinessScore}/100</div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{row.readinessLabel}</div>
                      </td>
                      <td className="py-3 pr-4">{row.activePolicies}</td>
                      <td className="py-3 pr-4">{row.expiringPolicies60d}</td>
                      <td className="py-3 pr-4">{row.pendingRenewals}</td>
                      <td className="py-3 pr-4">{row.latestPacketAt ? new Date(row.latestPacketAt).toLocaleDateString() : "—"}</td>
                      <td className="py-3">{row.primaryConcern}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {rows.length === 0 ? (
        <AdminEmptyState
          title="No league data available"
          description="The executive league needs facility, KPI, and board-packet data before it can rank facilities."
        />
      ) : null}
    </div>
  );
}

function LeagueMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "indigo",
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
  detail: string;
  tone?: "indigo" | "emerald" | "amber" | "red";
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

function LeagueValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-base font-medium text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
