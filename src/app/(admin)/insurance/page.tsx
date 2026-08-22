"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Umbrella } from "lucide-react";

import { InsuranceHubNav } from "./insurance-hub-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import { createClient } from "@/lib/supabase/client";
import { computeTotalCostOfRisk, type TcorSnapshot } from "@/lib/insurance/compute-tcor";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { insuranceHubKpiTileValue } from "@/lib/insurance/hub-kpi-copy";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import type { Database } from "@/types/database";

type EntityMini = { id: string; name: string };

type InsuranceHubSnapshot = {
  activePolicies: number;
  renewalsInFlight: number;
  openClaims: number;
  entities: EntityMini[];
};

export const INSURANCE_HUB_LOADING_PROFILE_COPY = "Loading insurance profile…";

export default function AdminInsuranceHubPage() {
  const supabase = createClient();
  const { organizationId, appRole, loading: authLoading } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const roleConfig = getRoleDashboardConfig(appRole as AppRole);
  const [entityFilter, setEntityFilter] = useState("");

  const {
    data: overview,
    isPending: overviewPending,
    error: overviewError,
  } = useQuery({
    queryKey: ["insurance", "hub-overview", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<InsuranceHubSnapshot> => {
      const oid = organizationId as string;
      const [{ data: entRows }, { count: polCount, error: e1 }, { count: renCount, error: e2 }, { count: clCount, error: e3 }] =
        await Promise.all([
          supabase
            .from("entities")
            .select("id, name")
            .eq("organization_id", oid)
            .is("deleted_at", null)
            .order("name"),
          supabase
            .from("insurance_policies")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", oid)
            .eq("status", "active")
            .is("deleted_at", null),
          supabase
            .from("insurance_renewals")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", oid)
            .in("status", ["upcoming", "in_progress"])
            .is("deleted_at", null),
          supabase
            .from("insurance_claims")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", oid)
            .in("status", ["reported", "investigating", "reserved", "partially_paid"])
            .is("deleted_at", null),
        ]);
      const err = e1 ?? e2 ?? e3;
      if (err) throw new Error(err.message);
      return {
        entities: (entRows ?? []) as EntityMini[],
        activePolicies: polCount ?? 0,
        renewalsInFlight: renCount ?? 0,
        openClaims: clCount ?? 0,
      };
    },
  });

  const {
    data: tcor,
    isPending: tcorPending,
    error: tcorError,
  } = useQuery({
    queryKey: ["insurance", "tcor", organizationId, entityFilter],
    enabled: !!organizationId,
    queryFn: async (): Promise<TcorSnapshot> => {
      const r = await computeTotalCostOfRisk(supabase, {
        organizationId: organizationId as string,
        entityId: entityFilter || null,
      });
      if (!r.ok) throw new Error(r.error);
      return r.snapshot;
    },
  });

  const loading = authLoading || overviewPending;
  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: overview != null,
  });
  const loadError = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError: overviewError?.message ?? null,
  });
  const entities = overview?.entities ?? [];
  const activePolicies = overview?.activePolicies ?? null;
  const renewalsInFlight = overview?.renewalsInFlight ?? null;
  const openClaims = overview?.openClaims ?? null;
  const tcorLoading = tcorPending;
  const tcorErrorMessage = tcorError?.message ?? null;
  const kpiCtx = {
    organizationId: organizationId ?? null,
    loadFailed: !!overviewError,
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <InsuranceHubNav />
        <div className="flex items-center gap-3">
          <Umbrella className="h-8 w-8 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Insurance & risk</h1>
            <p className="text-sm text-muted-foreground">
              Corporate policies, renewals, claims, COIs, and workers&apos; compensation (Module 18).
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {authLoading
                ? "Role context will appear when the operator profile is ready."
                : `${roleConfig.roleLabel} drill-in: keep policy posture, claims movement, and renewal exposure close to the executive exception flow.`}
            </p>
          </div>
        </div>

        {authLoading ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {INSURANCE_HUB_LOADING_PROFILE_COPY}
          </p>
        ) : null}

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { title: "Executive alerts", description: "Return to the leadership queue after checking risk exposure.", href: "/admin/executive/alerts" },
            { title: "Finance hub", description: "Cross-check reserve pressure and policy costs against the finance controls.", href: "/admin/finance" },
            { title: "Open claims", description: "Go straight to active claims when the risk lane needs detail.", href: "/admin/insurance/claims" },
          ].map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="rounded-lg border border-border bg-card p-5 shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            >
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-foreground">{item.description}</p>
            </Link>
          ))}
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              <MonolithicWatermark value={activePolicies ?? 0} className="text-muted-foreground/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                  Active Policies
                </h3>
                <p className="text-4xl font-mono tracking-tighter pb-1">
                  {loading ? "…" : insuranceHubKpiTileValue("active_policies", activePolicies, kpiCtx)}
                </p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald">
              <MonolithicWatermark value={renewalsInFlight ?? 0} className="text-success/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   Renewals in Flight
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">
                  {loading ? "…" : insuranceHubKpiTileValue("renewals_in_flight", renewalsInFlight, kpiCtx)}
                </p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card
              hoverColor="red"
              className={openClaims && openClaims > 0 ? "border-destructive/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]" : "border-border"}
            >
              <MonolithicWatermark
                value={openClaims ?? 0}
                className={openClaims && openClaims > 0 ? "text-destructive/10 opacity-50" : "text-muted-foreground/10 opacity-50"}
              />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3
                  className={
                    openClaims && openClaims > 0
                      ? "text-[10px] font-mono tracking-wider uppercase text-red-600 dark:text-red-400 flex items-center gap-2"
                      : "text-[10px] font-mono tracking-wider uppercase text-muted-foreground flex items-center gap-2"
                  }
                >
                   Open Claims
                </h3>
                <p
                  className={
                    openClaims && openClaims > 0
                      ? "text-4xl font-mono tracking-tighter text-red-600 dark:text-red-400 pb-1"
                      : "text-4xl font-mono tracking-tighter text-foreground pb-1"
                  }
                >
                  {loading ? "…" : insuranceHubKpiTileValue("open_claims", openClaims, kpiCtx)}
                </p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <div className="relative overflow-visible z-10 w-full mt-4 space-y-8">
        <div className="relative overflow-visible z-10 w-full">
          <div className="p-4 sm:p-6 mb-4 rounded-lg border border-border bg-card shadow-sm">
            <h3 className="text-xl font-semibold text-foreground mb-1">Total cost of risk (TCoR)</h3>
            <p className="text-sm font-mono tracking-wide text-muted-foreground">
              Module 18 Enhanced — rolling ~12 months. Premiums sum stated policy premiums for in-force policies
              overlapping the window; losses sum paid + reserve on claims whose loss date (or reported date) falls in the
              window. Operational estimate, not GAAP.
            </p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card text-sm shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tcor-entity">Entity</Label>
              <select
                id="tcor-entity"
                className="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                disabled={loading || !organizationId}
              >
                <option value="">All entities</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {tcorErrorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {tcorErrorMessage}
            </p>
          ) : null}
          {tcorLoading ? (
            <p className="text-sm text-muted-foreground">Loading TCoR…</p>
          ) : tcor ? (
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Window (Eastern):</span>{" "}
                <span className="font-mono text-xs">
                  {tcor.periodStart} → {tcor.periodEnd}
                </span>
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Policies in window:</span>{" "}
                {tcor.policyRows}
              </p>
              <p>
                <span className="text-muted-foreground">Premiums (stated):</span>{" "}
                <span className="font-semibold tabular-nums">{formatUsdFromCents(tcor.premiumsCents)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Incurred losses (paid + reserve, {tcor.claimRows} claims):</span>{" "}
                <span className="font-semibold tabular-nums">{formatUsdFromCents(tcor.incurredLossesCents)}</span>
              </p>
              <p className="md:col-span-2 border-t border-border pt-3">
                <span className="text-muted-foreground">TCoR (simple sum):</span>{" "}
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {formatUsdFromCents(tcor.tcorCents)}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No TCoR data.</p>
          )}
        </div>
        </div>

        <div className="relative overflow-visible z-10 w-full mt-4">
          <div className="p-4 sm:p-6 mb-4 rounded-lg border border-border bg-card shadow-sm">
            <h3 className="text-xl font-semibold text-foreground mb-1">Quick links</h3>
            <p className="text-sm font-mono tracking-wide text-muted-foreground">Navigate insurance workflows.</p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card flex flex-col gap-3 text-sm shadow-sm">
          <Link className="text-primary-600 dark:text-primary-400 font-mono text-xs hover:text-primary-500 transition-colors" href="/admin/insurance/policies">
            Policy inventory
          </Link>
          <Link className="text-primary-600 dark:text-primary-400 font-mono text-xs hover:text-primary-500 transition-colors" href="/admin/insurance/renewals">
            Renewals
          </Link>
          <Link className="text-primary-600 dark:text-primary-400 font-mono text-xs hover:text-primary-500 transition-colors" href="/admin/insurance/renewal-packages">
            Renewal data packages
          </Link>
          <Link className="text-primary-600 dark:text-primary-400 font-mono text-xs hover:text-primary-500 transition-colors" href="/admin/insurance/claims">
            Claims
          </Link>
          <Link className="text-primary-600 dark:text-primary-400 font-mono text-xs hover:text-primary-500 transition-colors" href="/admin/insurance/coi">
            Certificates of insurance
          </Link>
          <Link className="text-primary-600 dark:text-primary-400 font-mono text-xs hover:text-primary-500 transition-colors" href="/admin/insurance/workers-comp">
            Workers&apos; comp
          </Link>
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}
