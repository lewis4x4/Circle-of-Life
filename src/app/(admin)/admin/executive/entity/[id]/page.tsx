"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Building2, ExternalLink } from "lucide-react";

import { ExecutiveHubNav } from "../../../../executive/executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function FacilityKpiStrip(props: { kpi: ExecKpiPayload }) {
  const { kpi } = props;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
      <span>
        Census: {kpi.census.occupiedResidents}/{kpi.census.licensedBeds} beds
        {kpi.census.occupancyPct != null ? ` · ${kpi.census.occupancyPct}%` : ""}
      </span>
      <span>
        AR: {kpi.financial.openInvoicesCount} open · {money.format(kpi.financial.totalBalanceDueCents / 100)}
      </span>
      <span>
        Safety: {kpi.clinical.openIncidents} inc. · {kpi.clinical.medicationErrorsMtd} med err.
      </span>
      <span>Compliance: {kpi.compliance.openSurveyDeficiencies} def.</span>
    </div>
  );
}

export default function ExecutiveEntityDetailPage() {
  const params = useParams();
  const entityId = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [kpisByFacility, setKpisByFacility] = useState<Record<string, ExecKpiPayload | null>>({});

  const load = useCallback(async () => {
    if (!entityId) {
      setError("Missing entity id.");
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

      const { data: ent, error: entErr } = await supabase
        .from("entities")
        .select("id, name, organization_id")
        .eq("id", entityId)
        .is("deleted_at", null)
        .maybeSingle();

      if (entErr) throw entErr;
      if (!ent || ent.organization_id !== ctx.ctx.organizationId) {
        setError("Entity not found or not in your organization.");
        setEntityName(null);
        setFacilities([]);
        setKpisByFacility({});
        return;
      }

      setEntityName(ent.name);

      const { data: facs, error: fErr } = await supabase
        .from("facilities")
        .select("id, name")
        .eq("entity_id", entityId)
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("name");

      if (fErr) throw fErr;
      const list = facs ?? [];
      setFacilities(list.map((f) => ({ id: f.id, name: f.name })));

      const kpiEntries = await Promise.all(
        list.map(async (f) => {
          try {
            const kpi = await fetchExecutiveKpiSnapshot(supabase, ctx.ctx.organizationId, f.id);
            return [f.id, kpi] as const;
          } catch {
            return [f.id, null] as const;
          }
        }),
      );
      setKpisByFacility(Object.fromEntries(kpiEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load entity.");
      setEntityName(null);
      setFacilities([]);
      setKpisByFacility({});
    } finally {
      setLoading(false);
    }
  }, [supabase, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-3">
        <Link
          href="/admin/executive/entity"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit gap-1 -ml-2")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All entities
        </Link>
        <div className="flex items-start gap-3">
          <Building2 className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
              {loading ? <Skeleton className="inline-block h-8 w-48" /> : entityName ?? "Entity"}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Facilities in this entity with live KPI aggregates (same sources as the command center).
            </p>
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
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!loading && !error && facilities.length === 0 && entityName && (
        <p className="text-sm text-slate-500 dark:text-slate-400">No facilities linked to this entity yet.</p>
      )}

      {!loading &&
        !error &&
        facilities.map((f) => {
          const kpi = kpisByFacility[f.id];
          return (
            <Card key={f.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">{f.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Facility</Badge>
                  </CardDescription>
                </div>
                <Link
                  href="/admin/residents"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0 gap-1")}
                >
                  Residents
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </Link>
              </CardHeader>
              <CardContent>
                {kpi ? (
                  <FacilityKpiStrip kpi={kpi} />
                ) : (
                  <p className="text-sm text-slate-500">KPIs unavailable for this facility.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
