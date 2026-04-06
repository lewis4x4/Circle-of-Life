"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Building2, ExternalLink } from "lucide-react";

import { ExecutiveHubNav } from "../../executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { computeTotalCostOfRisk, type TcorSnapshot } from "@/lib/insurance/compute-tcor";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function KpiStrip(props: { kpi: ExecKpiPayload }) {
  const { kpi } = props;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
      <span>
        Census: {kpi.census.occupiedResidents}/{kpi.census.licensedBeds} beds
        {kpi.census.occupancyPct != null ? ` · ${kpi.census.occupancyPct}%` : ""}
      </span>
      <span>
        AR: {kpi.financial.openInvoicesCount} open · {money.format(kpi.financial.totalBalanceDueCents / 100)}
      </span>
      <span>
        Safety: {kpi.clinical.openIncidents} open incidents · {kpi.clinical.medicationErrorsMtd} med errors (MTD)
      </span>
      <span>Compliance: {kpi.compliance.openSurveyDeficiencies} deficiencies</span>
      <span>Workforce: {kpi.workforce.certificationsExpiring30d} certs expiring (30d)</span>
      <span>Infection: {kpi.infection.activeOutbreaks} active outbreaks</span>
    </div>
  );
}

export default function ExecutiveFacilityDetailPage() {
  const params = useParams();
  const rawId = typeof params.id === "string" ? params.id : "";
  const facilityId = UUID_RE.test(rawId) ? rawId : "";
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [kpi, setKpi] = useState<ExecKpiPayload | null>(null);
  const [tcor, setTcor] = useState<TcorSnapshot | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) {
      setError("Invalid facility id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        return;
      }

      const { data: fac, error: fErr } = await supabase
        .from("facilities")
        .select("id, name, entity_id, organization_id")
        .eq("id", facilityId)
        .is("deleted_at", null)
        .maybeSingle();

      if (fErr) throw fErr;
      if (!fac || fac.organization_id !== ctx.ctx.organizationId) {
        setError("Facility not found or not in your organization.");
        setFacilityName(null);
        setEntityId(null);
        setEntityName(null);
        setKpi(null);
        setTcor(null);
        return;
      }

      setFacilityName(fac.name);
      setEntityId(fac.entity_id);

      const { data: ent } = await supabase.from("entities").select("name").eq("id", fac.entity_id).maybeSingle();
      setEntityName((ent as { name: string } | null)?.name ?? null);

      const [kpiData, tcorResult] = await Promise.all([
        fetchExecutiveKpiSnapshot(supabase, ctx.ctx.organizationId, facilityId),
        computeTotalCostOfRisk(supabase, {
          organizationId: ctx.ctx.organizationId,
          entityId: fac.entity_id,
        }),
      ]);
      setKpi(kpiData);
      setTcor(tcorResult.ok ? tcorResult.snapshot : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load facility.");
      setFacilityName(null);
      setKpi(null);
      setTcor(null);
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-3">
        <Link
          href="/admin/executive"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit gap-1 -ml-2")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Executive overview
        </Link>
        {entityId ? (
          <Link
            href={`/admin/executive/entity/${entityId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit gap-1 -ml-2 text-slate-600")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Entity: {entityName ?? "…"}
          </Link>
        ) : null}
        <div className="flex items-start gap-3">
          <Building2 className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
              {loading ? <Skeleton className="inline-block h-8 w-56" /> : facilityName ?? "Facility"}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Facility drill-down (Module 24) — same KPI engine as the command center, scoped to this site.
            </p>
            {entityName ? (
              <p className="mt-1 text-xs text-slate-500">
                Legal entity: {entityName}
                {entityId ? (
                  <>
                    {" "}
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/executive/entity/${entityId}`}>
                      View entity
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && !error && (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!loading && !error && kpi && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Live KPIs</CardTitle>
            <CardDescription>
              <Badge variant="outline">Scoped facility</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KpiStrip kpi={kpi} />
          </CardContent>
        </Card>
      )}

      {!loading && !error && tcor && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Insurance (TCoR)</CardTitle>
            <CardDescription>
              Rolling ~12 months for the legal entity that owns this facility ({tcor.periodStart} → {tcor.periodEnd}).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Total:</span>{" "}
              <span className="font-semibold tabular-nums">{money.format(tcor.tcorCents / 100)}</span>
              {" · "}
              <span className="text-slate-500">Premiums:</span> {money.format(tcor.premiumsCents / 100)}
              {" · "}
              <span className="text-slate-500">Incurred losses:</span> {money.format(tcor.incurredLossesCents / 100)}
            </p>
            <Link className="text-primary text-sm underline-offset-4 hover:underline" href="/admin/insurance">
              Open insurance hub <ExternalLink className="inline h-3.5 w-3.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      )}

      {!loading && !error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick links</CardTitle>
            <CardDescription>Source modules for this facility context.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/residents">
              Residents
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/incidents">
              Incidents
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/billing/invoices">
              Invoices
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/infection-control">
              Infection control
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
