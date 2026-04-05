"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, ExternalLink } from "lucide-react";

import { ExecutiveHubNav } from "./executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { fetchExecutiveAlerts, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function severityBadgeVariant(
  s: ExecutiveAlertRow["severity"],
): "destructive" | "secondary" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "warning") return "secondary";
  return "outline";
}

export default function ExecutiveCommandCenterPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [kpis, setKpis] = useState<ExecKpiPayload | null>(null);
  const [alerts, setAlerts] = useState<ExecutiveAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setKpis(null);
        setAlerts([]);
        return;
      }
      const [kpiData, alertData] = await Promise.all([
        fetchExecutiveKpiSnapshot(supabase, ctx.ctx.organizationId, selectedFacilityId),
        fetchExecutiveAlerts(supabase, ctx.ctx.organizationId, selectedFacilityId, 10),
      ]);
      setKpis(kpiData);
      setAlerts(alertData);
    } catch (e) {
      setKpis(null);
      setAlerts([]);
      setError(e instanceof Error ? e.message : "Unable to load executive data.");
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const top3 = alerts.slice(0, 3);

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Executive</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Organization command center (Module 24) — portfolio KPIs, alerts, and links into source modules.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          title="Census & occupancy"
          description="Active residents vs licensed beds"
          loading={loading}
          value={
            kpis
              ? `${kpis.census.occupiedResidents} / ${kpis.census.licensedBeds} beds${
                  kpis.census.occupancyPct != null ? ` · ${kpis.census.occupancyPct}% occ.` : ""
                }`
              : "—"
          }
          href="/admin/residents"
          linkLabel="Residents"
        />
        <KpiCard
          title="Accounts receivable"
          description="Open invoices with balance"
          loading={loading}
          value={
            kpis
              ? `${kpis.financial.openInvoicesCount} open · ${money.format(kpis.financial.totalBalanceDueCents / 100)}`
              : "—"
          }
          href="/admin/billing/invoices"
          linkLabel="Invoices"
        />
        <KpiCard
          title="Clinical & safety"
          description="Open incidents; med errors (MTD)"
          loading={loading}
          value={kpis ? `${kpis.clinical.openIncidents} incidents · ${kpis.clinical.medicationErrorsMtd} med errors` : "—"}
          href="/admin/incidents"
          linkLabel="Incidents"
        />
        <KpiCard
          title="Compliance"
          description="Open survey deficiencies"
          loading={loading}
          value={kpis ? String(kpis.compliance.openSurveyDeficiencies) : "—"}
          href="/admin/compliance"
          linkLabel="Compliance"
        />
        <KpiCard
          title="Workforce"
          description="Staff certifications expiring (30d)"
          loading={loading}
          value={kpis ? String(kpis.workforce.certificationsExpiring30d) : "—"}
          href="/admin/certifications"
          linkLabel="Certifications"
        />
        <KpiCard
          title="Infection"
          description="Active outbreaks"
          loading={loading}
          value={kpis ? String(kpis.infection.activeOutbreaks) : "—"}
          href="/admin/infection-control"
          linkLabel="Infection control"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Top alerts</CardTitle>
            <CardDescription>Prioritized from `exec_alerts` (unresolved).</CardDescription>
          </div>
          <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/executive/alerts">
            View all
          </Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {!loading && top3.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No open executive alerts.</p>
          )}
          {!loading &&
            top3.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200/80 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityBadgeVariant(a.severity)}>{a.severity}</Badge>
                    <span className="text-xs uppercase text-slate-500">{a.source_module}</span>
                  </div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{a.title}</p>
                  {a.body && <p className="text-sm text-slate-600 dark:text-slate-400">{a.body}</p>}
                </div>
                {a.deep_link_path && (
                  <Link
                    href={a.deep_link_path}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0 gap-1")}
                  >
                    Open
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Link>
                )}
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard(props: {
  title: string;
  description: string;
  value: string;
  loading: boolean;
  href: string;
  linkLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {props.loading ? <Skeleton className="h-8 w-3/4" /> : <p className="text-xl font-semibold tabular-nums">{props.value}</p>}
        <Link className="text-sm text-primary underline-offset-4 hover:underline" href={props.href}>
          {props.linkLabel} →
        </Link>
      </CardContent>
    </Card>
  );
}
