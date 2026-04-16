"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Umbrella } from "lucide-react";

import { InsuranceHubNav } from "./insurance-hub-nav";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { computeTotalCostOfRisk, type TcorSnapshot } from "@/lib/insurance/compute-tcor";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";

export default function AdminInsuranceHubPage() {
  const supabase = createClient();
  const ownerConfig = getRoleDashboardConfig("owner");
  const [activePolicies, setActivePolicies] = useState<number | null>(null);
  const [renewalsInFlight, setRenewalsInFlight] = useState<number | null>(null);
  const [openClaims, setOpenClaims] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [entityFilter, setEntityFilter] = useState("");
  const [tcor, setTcor] = useState<TcorSnapshot | null>(null);
  const [tcorError, setTcorError] = useState<string | null>(null);
  const [tcorLoading, setTcorLoading] = useState(false);

  const loadTcor = useCallback(
    async (oid: string) => {
      setTcorLoading(true);
      setTcorError(null);
      try {
        const r = await computeTotalCostOfRisk(supabase, {
          organizationId: oid,
          entityId: entityFilter || null,
        });
        if (!r.ok) {
          setTcor(null);
          setTcorError(r.error);
          return;
        }
        setTcor(r.snapshot);
      } finally {
        setTcorLoading(false);
      }
    },
    [supabase, entityFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setActivePolicies(null);
        setRenewalsInFlight(null);
        setOpenClaims(null);
        setOrgId(null);
        setEntities([]);
        setLoadError(ctx.error);
        return;
      }
      const oid = ctx.ctx.organizationId;
      setOrgId(oid);

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
      if (err) {
        setLoadError(err.message);
        setActivePolicies(null);
        setRenewalsInFlight(null);
        setOpenClaims(null);
        return;
      }
      setEntities((entRows ?? []) as { id: string; name: string }[]);
      setActivePolicies(polCount ?? 0);
      setRenewalsInFlight(renCount ?? 0);
      setOpenClaims(clCount ?? 0);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!orgId) return;
    void loadTcor(orgId);
  }, [orgId, loadTcor]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={openClaims ? openClaims > 0 : false} 
        primaryClass="bg-blue-700/10"
        secondaryClass="bg-red-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <InsuranceHubNav />
        <div className="flex items-center gap-3">
          <Umbrella className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Insurance & risk</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Corporate policies, renewals, claims, COIs, and workers’ compensation (Module 18).
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
              {ownerConfig.roleLabel} drill-in: keep policy posture, claims movement, and renewal exposure close to the executive exception flow.
            </p>
          </div>
        </div>

        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
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
              className="rounded-[1.5rem] border border-slate-200/70 bg-white/70 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg dark:border-white/5 dark:bg-white/[0.03] dark:hover:border-indigo-500/30"
            >
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">{item.description}</p>
            </Link>
          ))}
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              <Sparkline colorClass="text-slate-400" variant={1} />
              <MonolithicWatermark value={activePolicies ?? 0} className="text-slate-800/5 dark:text-white/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 flex items-center gap-2">
                  Active Policies
                </h3>
                <p className="text-4xl font-mono tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-500 pb-1">{loading ? "…" : activePolicies ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald">
              <Sparkline colorClass="text-emerald-500" variant={3} />
              <MonolithicWatermark value={renewalsInFlight ?? 0} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   Renewals in Flight
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">{loading ? "…" : renewalsInFlight ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="red" className={openClaims ? "border-red-500/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]" : ""}>
              <Sparkline colorClass="text-red-500" variant={2} />
              <MonolithicWatermark value={openClaims ?? 0} className="text-red-600/5 dark:text-red-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-red-600 dark:text-red-400 flex items-center gap-2">
                     Open Claims
                  </h3>
                  {openClaims != null && openClaims > 0 && <PulseDot colorClass="bg-red-500" />}
                </div>
                <p className="text-4xl font-mono tracking-tighter text-red-600 dark:text-red-400 pb-1">{loading ? "…" : openClaims ?? "—"}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <div className="relative overflow-visible z-10 w-full mt-4 space-y-8">
        <div className="relative overflow-visible z-10 w-full">
          <div className="glass-panel p-4 sm:p-6 mb-4 rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-xl">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Total cost of risk (TCoR)</h3>
            <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">
              Module 18 Enhanced — rolling ~12 months. Premiums sum stated policy premiums for in-force policies
              overlapping the window; losses sum paid + reserve on claims whose loss date (or reported date) falls in the
              window. Operational estimate, not GAAP.
            </p>
          </div>
          <div className="glass-panel p-6 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 text-sm backdrop-blur-2xl shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tcor-entity">Entity</Label>
              <select
                id="tcor-entity"
                className="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                disabled={loading || !orgId}
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
          {tcorError ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {tcorError}
            </p>
          ) : null}
          {tcorLoading ? (
            <p className="text-sm text-slate-500">Loading TCoR…</p>
          ) : tcor ? (
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <p className="text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">Window:</span>{" "}
                <span className="font-mono text-xs">
                  {tcor.periodStart} → {tcor.periodEnd}
                </span>
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">Policies in window:</span>{" "}
                {tcor.policyRows}
              </p>
              <p>
                <span className="text-slate-500">Premiums (stated):</span>{" "}
                <span className="font-semibold tabular-nums">{formatUsdFromCents(tcor.premiumsCents)}</span>
              </p>
              <p>
                <span className="text-slate-500">Incurred losses (paid + reserve, {tcor.claimRows} claims):</span>{" "}
                <span className="font-semibold tabular-nums">{formatUsdFromCents(tcor.incurredLossesCents)}</span>
              </p>
              <p className="md:col-span-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <span className="text-slate-500">TCoR (simple sum):</span>{" "}
                <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
                  {formatUsdFromCents(tcor.tcorCents)}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No TCoR data.</p>
          )}
        </div>
        </div>

        <div className="relative overflow-visible z-10 w-full mt-4">
          <div className="glass-panel p-4 sm:p-6 mb-4 rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-xl">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Quick links</h3>
            <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">Navigate insurance workflows.</p>
          </div>
          <div className="glass-panel p-6 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-3 text-sm backdrop-blur-2xl shadow-sm">
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/insurance/policies">
            Policy inventory
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/insurance/renewals">
            Renewals
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/insurance/renewal-packages">
            Renewal data packages
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/insurance/claims">
            Claims
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/insurance/coi">
            Certificates of insurance
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/insurance/workers-comp">
            Workers’ comp
          </Link>
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}
