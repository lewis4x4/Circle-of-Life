"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ExternalLink } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveHubNav } from "../../../../executive/executive-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { presenceSummaryText } from "@/lib/executive/presence-census";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const EXECUTIVE_ENTITY_DETAIL_LOADING_MESSAGE = "Loading entity portfolio…";
export const EXECUTIVE_ENTITY_DETAIL_EMPTY_FACILITIES_MESSAGE = "No facilities linked to this entity yet.";

function FacilityKpiStrip(props: { kpi: ExecKpiPayload }) {
  const { kpi } = props;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
      <span>
        Census: {kpi.census.occupiedResidents}/{kpi.census.licensedBeds} beds
        {kpi.census.occupancyPct != null ? ` · ${kpi.census.occupancyPct}%` : ""}
      </span>
      {kpi.census.presence ? <span>Presence: {presenceSummaryText(kpi.census.presence)}</span> : null}
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
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();

  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [kpisByFacility, setKpisByFacility] = useState<Record<string, ExecKpiPayload | null>>({});

  const hasOrgScopedData = Boolean(entityName || facilities.length > 0);
  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!entityId) {
      setFetchError("Missing entity id.");
      setEntityName(null);
      setFacilities([]);
      setKpisByFacility({});
      setFetching(false);
      return;
    }

    if (!organizationId) {
      setEntityName(null);
      setFacilities([]);
      setKpisByFacility({});
      setFetchError(null);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);
    try {
      const { data: ent, error: entErr } = await supabase
        .from("entities")
        .select("id, name, organization_id")
        .eq("id", entityId)
        .is("deleted_at", null)
        .maybeSingle();

      if (entErr) {
        setFetchError(entErr.message);
        return;
      }
      if (!ent || ent.organization_id !== organizationId) {
        setFetchError("Entity not found or not in your organization.");
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
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name");

      if (fErr) {
        setFetchError(fErr.message);
        return;
      }
      const list = facs ?? [];
      setFacilities(list.map((f) => ({ id: f.id, name: f.name })));

      const kpiEntries = await Promise.all(
        list.map(async (f) => {
          try {
            const kpi = await fetchExecutiveKpiSnapshot(supabase, organizationId, f.id);
            return [f.id, kpi] as const;
          } catch {
            return [f.id, null] as const;
          }
        }),
      );
      setKpisByFacility(Object.fromEntries(kpiEntries));
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Unable to load entity.");
      setEntityName(null);
      setFacilities([]);
      setKpisByFacility({});
    } finally {
      setFetching(false);
    }
  }, [authLoading, supabase, entityId, organizationId]);

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

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {fetchErrorBannerMessage ? (
        <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={() => void load()} />
      ) : null}

      {loading && !fetchErrorBannerMessage && !organizationGapMessage ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {EXECUTIVE_ENTITY_DETAIL_LOADING_MESSAGE}
        </p>
      ) : null}

      {!loading && !fetchErrorBannerMessage && !organizationGapMessage && facilities.length === 0 && entityName && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{EXECUTIVE_ENTITY_DETAIL_EMPTY_FACILITIES_MESSAGE}</p>
      )}

      {!loading &&
        !fetchErrorBannerMessage &&
        !organizationGapMessage &&
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
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/executive/facility/${f.id}`}
                    className={cn(buttonVariants({ variant: "default", size: "sm" }), "shrink-0 gap-1")}
                  >
                    Facility view
                  </Link>
                  <Link
                    href="/admin/residents"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0 gap-1")}
                  >
                    Residents
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
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
