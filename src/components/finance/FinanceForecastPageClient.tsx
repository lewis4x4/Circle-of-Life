"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw, TrendingUp, Wallet, Wrench } from "lucide-react";

import { FinanceHubNav } from "@/app/(admin)/finance/finance-hub-nav";
import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/finance/format-cents";
import type { ForecastSnapshot } from "@/lib/finance/load-forecast-data";

type FinanceForecastPageClientProps = {
  initialData: ForecastSnapshot | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

function formatDays(value: number): string {
  return `${value.toFixed(1)}d`;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatMonthOffset(months: number): string {
  if (months < 0) return `${Math.abs(months)} mo overdue`;
  if (months === 0) return "this month";
  if (months === 1) return "1 mo";
  return `${months} mo`;
}

export default function FinanceForecastPageClient({
  initialData,
  initialError,
  initialFacilityId,
}: FinanceForecastPageClientProps) {
  const router = useRouter();
  const snapshot: ForecastSnapshot | null = initialData;
  const error = initialError;

  const scopeLabel = useMemo(() => {
    if (!initialFacilityId) return "Portfolio scope · all accessible facilities";
    const scopedFacility = snapshot?.facilities.find((facility) => facility.id === initialFacilityId);
    return `Facility scope · ${scopedFacility?.name ?? "selected facility"}`;
  }, [initialFacilityId, snapshot?.facilities]);

  return (
    <div className="space-y-6">
      <FinanceHubNav />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            <span>{scopeLabel}</span>
            <span>·</span>
            <span>AR velocity, service cost, and replacement pressure</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Forecast</h1>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Project DSO, trailing 30-day cost-to-serve, and the three-year capital horizon from live billing,
              payroll, vendor, trust, and asset records.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/finance/trust">
            Trust
          </Link>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/finance/period-close">
            Close
          </Link>
        </div>
      </div>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => router.refresh()} /> : null}

      {snapshot ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ForecastMetricCard
              icon={Wallet}
              label="Gross AR exposure"
              value={formatCents(snapshot.dso.summary.openArCents)}
              detail={`Trust coverage ${formatCents(snapshot.dso.summary.trustCoverageCents)}`}
            />
            <ForecastMetricCard
              icon={TrendingUp}
              label="DSO run-rate"
              value={formatDays(snapshot.dso.summary.currentDsoDays)}
              detail={`Projected 30d ${formatDays(snapshot.dso.summary.projected30DayDsoDays)}`}
              accent={
                snapshot.dso.summary.projected30DayDsoDays > snapshot.dso.summary.currentDsoDays
                  ? "amber"
                  : "emerald"
              }
            />
            <ForecastMetricCard
              icon={ArrowRight}
              label="30d cost / resident"
              value={
                snapshot.cost.summary.costPerResidentCents != null
                  ? formatCents(snapshot.cost.summary.costPerResidentCents)
                  : "—"
              }
              detail={`${snapshot.cost.summary.activeResidents} active residents in scope`}
            />
            <ForecastMetricCard
              icon={Wrench}
              label="Capex due next 12m"
              value={formatCents(snapshot.capex.summary.due12MonthsCostCents)}
              detail={`${snapshot.capex.summary.due12MonthsCount} asset(s) due`}
              accent={snapshot.capex.summary.overdueCount > 0 ? "red" : "indigo"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>DSO projection</CardTitle>
              <CardDescription>
                Current open AR against trailing 90-day billing and collection velocity. Gross exposure stays separate
                from trust coverage so forecast values do not blur with cash-on-hand offsets.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <MetricInline label="Trailing 90d billed" value={formatCents(snapshot.dso.summary.trailing90BilledCents)} />
                <MetricInline label="Trailing 90d collected" value={formatCents(snapshot.dso.summary.trailing90CollectedCents)} />
                <MetricInline label="Collection efficiency" value={formatPct(snapshot.dso.summary.collectionEfficiencyPct)} />
                <MetricInline label="Net uncovered AR" value={formatCents(snapshot.dso.summary.netExposureCents)} />
              </div>

              {snapshot.dso.rows.length === 0 ? (
                <AdminEmptyState
                  title="No AR activity in scope"
                  description="Billing and payment records are required before DSO forecasting can render."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="pb-2 pr-4 font-medium">Facility</th>
                        <th className="pb-2 pr-4 font-medium">Open AR</th>
                        <th className="pb-2 pr-4 font-medium">Trust coverage</th>
                        <th className="pb-2 pr-4 font-medium">Current DSO</th>
                        <th className="pb-2 pr-4 font-medium">Projected 30d</th>
                        <th className="pb-2 pr-4 font-medium">Collections / 90d</th>
                        <th className="pb-2 font-medium">Efficiency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.dso.rows.map((row) => (
                        <tr key={row.facilityId} className="border-b border-slate-100 dark:border-slate-900">
                          <td className="py-3 pr-4">{row.facilityName}</td>
                          <td className="py-3 pr-4">{formatCents(row.openArCents)}</td>
                          <td className="py-3 pr-4">{formatCents(row.trustCoverageCents)}</td>
                          <td className="py-3 pr-4">{formatDays(row.currentDsoDays)}</td>
                          <td className="py-3 pr-4">
                            <span
                              className={
                                row.projected30DayDsoDays > row.currentDsoDays
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }
                            >
                              {formatDays(row.projected30DayDsoDays)}
                            </span>
                          </td>
                          <td className="py-3 pr-4">{formatCents(row.trailing90CollectedCents)}</td>
                          <td className="py-3">{formatPct(row.collectionEfficiencyPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <Card>
              <CardHeader>
                <CardTitle>Cost to serve</CardTitle>
                <CardDescription>
                  Trailing 30-day approved payroll and vendor invoice run-rate divided by active residents in scope.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                  <MetricInline label="Labor run-rate" value={formatCents(snapshot.cost.summary.laborCostCents)} />
                  <MetricInline label="Vendor run-rate" value={formatCents(snapshot.cost.summary.vendorCostCents)} />
                  <MetricInline label="Approved hours" value={snapshot.cost.summary.approvedHours.toFixed(1)} />
                  <MetricInline label="Overtime hours" value={snapshot.cost.summary.overtimeHours.toFixed(1)} />
                </div>

                {snapshot.cost.rows.length === 0 ? (
                  <AdminEmptyState
                    title="No service-cost records in scope"
                    description="Approved payroll records or vendor invoices are required before cost-to-serve can render."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800">
                          <th className="pb-2 pr-4 font-medium">Facility</th>
                          <th className="pb-2 pr-4 font-medium">Residents</th>
                          <th className="pb-2 pr-4 font-medium">Labor</th>
                          <th className="pb-2 pr-4 font-medium">Vendor</th>
                          <th className="pb-2 pr-4 font-medium">Total</th>
                          <th className="pb-2 font-medium">Cost / resident</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.cost.rows.map((row) => (
                          <tr key={row.facilityId} className="border-b border-slate-100 dark:border-slate-900">
                            <td className="py-3 pr-4">{row.facilityName}</td>
                            <td className="py-3 pr-4">{row.activeResidents}</td>
                            <td className="py-3 pr-4">{formatCents(row.laborCostCents)}</td>
                            <td className="py-3 pr-4">{formatCents(row.vendorCostCents)}</td>
                            <td className="py-3 pr-4">{formatCents(row.totalCostCents)}</td>
                            <td className="py-3">
                              {row.costPerResidentCents != null ? formatCents(row.costPerResidentCents) : "—"}
                            </td>
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
                <CardTitle>Capex horizon</CardTitle>
                <CardDescription>
                  Replacement schedule built from asset lifecycle dates and replacement estimates over the next 36 months.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricInline label="Overdue" value={formatCents(snapshot.capex.summary.overdueCostCents)} />
                  <MetricInline label="Next 12m" value={formatCents(snapshot.capex.summary.due12MonthsCostCents)} />
                  <MetricInline label="13-36m" value={formatCents(snapshot.capex.summary.due36MonthsCostCents)} />
                </div>

                {snapshot.capex.dueSoon.length === 0 ? (
                  <AdminEmptyState
                    title="No capital replacements scheduled"
                    description="Asset lifecycle replacement dates are required before the capex horizon can render."
                  />
                ) : (
                  <div className="space-y-3">
                    {snapshot.capex.dueSoon.map((asset) => (
                      <div
                        key={asset.id}
                        className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">{asset.assetName}</p>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                              {asset.facilityName} · {asset.assetType.replaceAll("_", " ")}
                            </p>
                          </div>
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {formatCents(asset.replacementCostCents)}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                          <span>{asset.dueDate}</span>
                          <span>{formatMonthOffset(asset.monthsFromNow)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Capex by facility</CardTitle>
              <CardDescription>
                Facility roll-up of overdue replacements, next-12-month obligations, and the outer 13-36 month horizon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.capex.rows.length === 0 ? (
                <AdminEmptyState
                  title="No facility capex roll-up in scope"
                  description="Add asset replacement dates and estimates to begin building the three-year capital plan."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="pb-2 pr-4 font-medium">Facility</th>
                        <th className="pb-2 pr-4 font-medium">Overdue</th>
                        <th className="pb-2 pr-4 font-medium">Next 12m</th>
                        <th className="pb-2 pr-4 font-medium">13-36m</th>
                        <th className="pb-2 pr-4 font-medium">Due asset count</th>
                        <th className="pb-2 font-medium">Pressure lane</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.capex.rows.map((row) => {
                        const dueAssets = row.overdueCount + row.due12MonthsCount + row.due36MonthsCount;
                        const isHot = row.overdueCount > 0 || row.due12MonthsCostCents > 2500000;
                        return (
                          <tr key={row.facilityId} className="border-b border-slate-100 dark:border-slate-900">
                            <td className="py-3 pr-4">{row.facilityName}</td>
                            <td className="py-3 pr-4">{formatCents(row.overdueCostCents)}</td>
                            <td className="py-3 pr-4">{formatCents(row.due12MonthsCostCents)}</td>
                            <td className="py-3 pr-4">{formatCents(row.due36MonthsCostCents)}</td>
                            <td className="py-3 pr-4">{dueAssets}</td>
                            <td className="py-3">
                              <span
                                className={
                                  isHot
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-emerald-600 dark:text-emerald-400"
                                }
                              >
                                {isHot ? "Escalate" : "Monitor"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ForecastMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent = "indigo",
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  detail: string;
  accent?: "indigo" | "emerald" | "amber" | "red";
}) {
  const accentClass =
    accent === "emerald"
      ? "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
      : accent === "amber"
        ? "border-amber-200/80 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
        : accent === "red"
          ? "border-red-200/80 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20"
          : "border-indigo-200/80 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20";

  return (
    <Card className={accentClass}>
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

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
