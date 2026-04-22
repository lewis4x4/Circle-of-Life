"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, TrendingUp, Wallet, Wrench } from "lucide-react";

import { FinanceHubNav } from "../finance-hub-nav";
import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { formatCents } from "@/lib/finance/format-cents";
import {
  buildCapexForecast,
  buildCostToServeForecast,
  buildDsoForecast,
  type CapexDueAssetRow,
  type CapexFacilityRow,
  type CapexSummary,
  type CostToServeFacilityRow,
  type CostToServeSummary,
  type DsoFacilityRow,
  type DsoSummary,
  type ForecastFacility,
  type ForecastFacilityAsset,
} from "@/lib/finance/forecast";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import type { Tables } from "@/types/database";

type ForecastSnapshot = {
  facilities: ForecastFacility[];
  dso: {
    summary: DsoSummary;
    rows: DsoFacilityRow[];
  };
  cost: {
    summary: CostToServeSummary;
    rows: CostToServeFacilityRow[];
  };
  capex: {
    summary: CapexSummary;
    rows: CapexFacilityRow[];
    dueSoon: CapexDueAssetRow[];
  };
};

type FacilityAssetQueryRow = ForecastFacilityAsset & {
  deleted_at?: string | null;
};

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

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

export default function FinanceForecastPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [snapshot, setSnapshot] = useState<ForecastSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopeFacilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      const billedStart = daysAgoIso(90);
      const laborStart = daysAgoIso(30);

      let facilitiesQuery = supabase
        .from("facilities")
        .select("id, name, entity_id")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("name");

      let openInvoicesQuery = supabase
        .from("invoices")
        .select("id, facility_id, resident_id, invoice_date, due_date, total, balance_due, status")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .in("status", ["sent", "partial", "overdue"]);

      let billedInvoicesQuery = supabase
        .from("invoices")
        .select("id, facility_id, resident_id, invoice_date, due_date, total, balance_due, status")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .gte("invoice_date", billedStart)
        .in("status", ["sent", "paid", "partial", "overdue"]);

      let paymentsQuery = supabase
        .from("payments")
        .select("facility_id, payment_date, amount")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .gte("payment_date", billedStart);

      let trustEntriesQuery = supabase
        .from("trust_account_entries")
        .select("resident_id, facility_id, entry_date, balance_after_cents")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false });

      let timeRecordsQuery = supabase
        .from("time_records")
        .select("staff_id, facility_id, clock_in, actual_hours, regular_hours, overtime_hours")
        .eq("organization_id", ctx.ctx.organizationId)
        .eq("approved", true)
        .is("deleted_at", null)
        .gte("clock_in", `${laborStart}T00:00:00.000Z`);

      let staffRatesQuery = supabase
        .from("staff")
        .select("id, facility_id, hourly_rate, overtime_rate, employment_status, staff_role")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null);

      let vendorInvoicesQuery = supabase
        .from("vendor_invoices")
        .select("facility_id, invoice_date, status, total_cents")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .gte("invoice_date", laborStart)
        .in("status", ["submitted", "approved", "matched", "paid"]);

      let residentsQuery = supabase
        .from("residents")
        .select("id, facility_id, status")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .in("status", ["active", "hospital_hold", "loa"]);

      let facilityAssetsQuery = supabase
        .from("facility_assets" as never)
        .select(
          "id, facility_id, asset_type, name, status, lifecycle_replace_by, replacement_cost_estimate_cents, deleted_at",
        )
        .eq("organization_id" as never, ctx.ctx.organizationId as never)
        .order("lifecycle_replace_by" as never, { ascending: true });

      if (scopeFacilityId) {
        facilitiesQuery = facilitiesQuery.eq("id", scopeFacilityId);
        openInvoicesQuery = openInvoicesQuery.eq("facility_id", scopeFacilityId);
        billedInvoicesQuery = billedInvoicesQuery.eq("facility_id", scopeFacilityId);
        paymentsQuery = paymentsQuery.eq("facility_id", scopeFacilityId);
        trustEntriesQuery = trustEntriesQuery.eq("facility_id", scopeFacilityId);
        timeRecordsQuery = timeRecordsQuery.eq("facility_id", scopeFacilityId);
        staffRatesQuery = staffRatesQuery.eq("facility_id", scopeFacilityId);
        vendorInvoicesQuery = vendorInvoicesQuery.eq("facility_id", scopeFacilityId);
        residentsQuery = residentsQuery.eq("facility_id", scopeFacilityId);
        facilityAssetsQuery = facilityAssetsQuery.eq("facility_id" as never, scopeFacilityId as never);
      }

      const [
        facilitiesRes,
        openInvoicesRes,
        billedInvoicesRes,
        paymentsRes,
        trustEntriesRes,
        timeRecordsRes,
        staffRatesRes,
        vendorInvoicesRes,
        residentsRes,
        facilityAssetsRes,
      ] = await Promise.all([
        facilitiesQuery,
        openInvoicesQuery,
        billedInvoicesQuery,
        paymentsQuery,
        trustEntriesQuery,
        timeRecordsQuery,
        staffRatesQuery,
        vendorInvoicesQuery,
        residentsQuery,
        facilityAssetsQuery,
      ]);

      const responses = [
        facilitiesRes,
        openInvoicesRes,
        billedInvoicesRes,
        paymentsRes,
        trustEntriesRes,
        timeRecordsRes,
        staffRatesRes,
        vendorInvoicesRes,
        residentsRes,
        facilityAssetsRes,
      ];

      for (const response of responses) {
        if (response.error) throw response.error;
      }

      const facilities = (facilitiesRes.data ?? []) as ForecastFacility[];
      const openInvoices = (openInvoicesRes.data ?? []) as Array<
        Pick<Tables<"invoices">, "id" | "facility_id" | "resident_id" | "invoice_date" | "due_date" | "total" | "balance_due" | "status">
      >;
      const billedInvoices = (billedInvoicesRes.data ?? []) as Array<
        Pick<Tables<"invoices">, "id" | "facility_id" | "resident_id" | "invoice_date" | "due_date" | "total" | "balance_due" | "status">
      >;
      const payments = (paymentsRes.data ?? []) as Array<Pick<Tables<"payments">, "facility_id" | "payment_date" | "amount">>;
      const trustEntries = (trustEntriesRes.data ?? []) as Array<
        Pick<Tables<"trust_account_entries">, "resident_id" | "facility_id" | "entry_date" | "balance_after_cents">
      >;
      const timeRecords = (timeRecordsRes.data ?? []) as Array<
        Pick<Tables<"time_records">, "staff_id" | "facility_id" | "clock_in" | "actual_hours" | "regular_hours" | "overtime_hours">
      >;
      const staffRates = (staffRatesRes.data ?? []) as Array<
        Pick<Tables<"staff">, "id" | "facility_id" | "hourly_rate" | "overtime_rate" | "employment_status" | "staff_role">
      >;
      const vendorInvoices = (vendorInvoicesRes.data ?? []) as Array<
        Pick<Tables<"vendor_invoices">, "facility_id" | "invoice_date" | "status" | "total_cents">
      >;
      const residents = (residentsRes.data ?? []) as Array<Pick<Tables<"residents">, "id" | "facility_id" | "status">>;
      const facilityAssets = ((facilityAssetsRes.data ?? []) as unknown as FacilityAssetQueryRow[]).filter(
        (asset) => !asset.deleted_at,
      );

      setSnapshot({
        facilities,
        dso: buildDsoForecast({
          facilities,
          openInvoices,
          billedInvoices90d: billedInvoices,
          payments90d: payments,
          trustEntries,
        }),
        cost: buildCostToServeForecast({
          facilities,
          residents,
          timeRecords30d: timeRecords,
          staffRates,
          vendorInvoices30d: vendorInvoices,
        }),
        capex: buildCapexForecast({
          facilities,
          assets: facilityAssets,
        }),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load finance forecast.");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [scopeFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeLabel = useMemo(() => {
    if (!scopeFacilityId) return "Portfolio scope · all accessible facilities";
    const scopedFacility = snapshot?.facilities.find((facility) => facility.id === scopeFacilityId);
    return `Facility scope · ${scopedFacility?.name ?? "selected facility"}`;
  }, [scopeFacilityId, snapshot?.facilities]);

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
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4${loading ? " animate-spin" : ""}`} />
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

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

      {loading && !snapshot ? <AdminTableLoadingState /> : null}

      {!loading && snapshot ? (
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
              value={snapshot.cost.summary.costPerResidentCents != null ? formatCents(snapshot.cost.summary.costPerResidentCents) : "—"}
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
                <MetricInline
                  label="Collection efficiency"
                  value={formatPct(snapshot.dso.summary.collectionEfficiencyPct)}
                />
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
