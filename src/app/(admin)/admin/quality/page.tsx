"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, LineChart } from "lucide-react";

import { QualityHubNav } from "./quality-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type MeasureRow = Database["public"]["Tables"]["quality_measures"]["Row"];
type LatestRow = Database["public"]["Views"]["quality_latest_facility_measures"]["Row"] & {
  quality_measures?: { name: string; measure_key: string } | null;
};

export default function AdminQualityHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, user } = useHavenAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [measures, setMeasures] = useState<MeasureRow[]>([]);
  const [latest, setLatest] = useState<LatestRow[]>([]);
  const [pbjRows, setPbjRows] = useState<Database["public"]["Tables"]["pbj_export_batches"]["Row"][]>([]);
  const homeHref = useMemo(() => {
    const effectiveRole = getAppRoleFromClaims(user) || appRole;
    return effectiveRole ? getDashboardRouteForRole(effectiveRole) : "/admin";
  }, [appRole, user]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setMeasures([]);
      setLatest([]);
      setPbjRows([]);
      setLoading(false);
      return;
    }

    try {
      const { data: fac, error: facErr } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
      if (facErr || !fac?.organization_id) {
        setLoadError("Could not resolve organization for this facility.");
        setMeasures([]);
        setLatest([]);
        setPbjRows([]);
        return;
      }
      const [mRes, viewRes, pbjRes] = await Promise.all([
        supabase
          .from("quality_measures")
          .select("*")
          .eq("organization_id", fac.organization_id)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("name"),
        supabase.from("quality_latest_facility_measures").select("*").eq("facility_id", selectedFacilityId),
        supabase
          .from("pbj_export_batches")
          .select("*")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(15),
      ]);

      if (mRes.error) throw mRes.error;
      setMeasures((mRes.data ?? []) as MeasureRow[]);

      if (viewRes.error) throw viewRes.error;
      const rawLatest = (viewRes.data ?? []) as LatestRow[];
      const measureIds = [...new Set(rawLatest.map((r) => r.quality_measure_id).filter(Boolean))] as string[];
      const nameById: Record<string, { name: string; measure_key: string }> = {};
      if (measureIds.length > 0) {
        const { data: mNames } = await supabase.from("quality_measures").select("id, name, measure_key").in("id", measureIds);
        for (const row of mNames ?? []) {
          nameById[row.id] = { name: row.name, measure_key: row.measure_key };
        }
      }
      setLatest(
        rawLatest.map((r) => ({
          ...r,
          quality_measures: r.quality_measure_id ? nameById[r.quality_measure_id] ?? null : null,
        })),
      );

      if (pbjRes.error) throw pbjRes.error;
      setPbjRows((pbjRes.data ?? []) as Database["public"]["Tables"]["pbj_export_batches"]["Row"][]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load quality data.");
      setMeasures([]);
      setLatest([]);
      setPbjRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-blue-500/5" 
        secondaryClass="bg-indigo-500/5"
      />
      <div className="relative z-10 space-y-8 max-w-6xl mx-auto">
      <div>
        <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 10 / Quality Metrics</p>
        <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Measure Catalog
        </h1>
      </div>

      <QualityHubNav />

      {noFacility ? (
        <div className="rounded-[2rem] glass-panel bg-amber-50/40 dark:bg-amber-950/20 p-8 border border-amber-200/50 dark:border-amber-900/50 backdrop-blur-md">
          <h3 className="text-lg font-display font-semibold text-amber-900 dark:text-amber-300 mb-2">Facility Required</h3>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            Select a facility in the header to load results and PBJ batches. Measures are listed for the facility&apos;s organization.
          </p>
        </div>
      ) : null}

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      <KineticGrid className="grid-cols-1 sm:grid-cols-3 gap-5" staggerMs={60}>
        <div className="h-[140px]">
          <V2Card className="border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]" hoverColor="indigo">
            <Sparkline colorClass="text-indigo-500" variant={1} />
            <MonolithicWatermark value={loading ? 0 : measures.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
            <div className="relative z-10 flex flex-col h-full justify-between">
              <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400">
                 Active Measures
              </h3>
              <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{noFacility ? "—" : loading ? "—" : measures.length}</p>
            </div>
          </V2Card>
        </div>
        <div className="h-[140px]">
          <V2Card className="border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]" hoverColor="emerald">
            <Sparkline colorClass="text-emerald-500" variant={3} />
            <MonolithicWatermark value={loading ? 0 : latest.length} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
            <div className="relative z-10 flex flex-col h-full justify-between">
              <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400">
                 Latest Snapshot Rows
              </h3>
              <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">{noFacility ? "—" : loading ? "—" : latest.length}</p>
            </div>
          </V2Card>
        </div>
        <div className="h-[140px]">
          <V2Card className="border-slate-500/20 shadow-[inset_0_0_15px_rgba(100,116,139,0.05)]" hoverColor="slate">
            <Sparkline colorClass="text-slate-500" variant={4} />
            <MonolithicWatermark value={loading ? 0 : pbjRows.length} className="text-slate-600/5 dark:text-slate-400/5 opacity-50" />
            <div className="relative z-10 flex flex-col h-full justify-between">
              <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 dark:text-slate-400">
                 PBJ Batches
              </h3>
              <p className="text-4xl font-mono tracking-tighter text-slate-600 dark:text-slate-400 pb-1">{noFacility ? "—" : loading ? "—" : pbjRows.length}</p>
            </div>
          </V2Card>
        </div>
      </KineticGrid>

      <Link href="/admin/quality/measures/new" className="group block focus-visible:outline-none mt-2">
        <div className="glass-panel p-5 flex items-center gap-4 transition-all duration-300 hover:border-indigo-500/40 hover:bg-white/60 dark:hover:bg-indigo-900/10 cursor-pointer">
          <div className="rounded-xl bg-indigo-100 dark:bg-indigo-900/30 p-3 shadow-sm border border-indigo-200/50 dark:border-indigo-500/20 group-hover:scale-110 transition-transform">
            <LineChart className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400">
              Define a measure
            </h3>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Org admins add catalog rows (<code className="text-[10px] bg-slate-100 dark:bg-black/30 px-1 py-0.5 rounded text-slate-500">measure_key</code>, CMS tag optional).</p>
          </div>
        </div>
      </Link>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-indigo-500 drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
          <h2 className="text-xl font-display font-semibold tracking-tight text-slate-800 dark:text-slate-100">Measure Catalog</h2>
        </div>
        
        {noFacility || loading ? (
          <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : measures.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md max-w-xl mx-auto mt-8">
             <p className="font-medium">No Baseline Quality Measures.</p>
             <p className="text-sm opacity-80 mt-1">Use &apos;Define a measure&apos; to populate standard telemetry data.</p>
          </div>
        ) : (
          <MotionList className="space-y-2">
            {measures.map((m) => (
              <MotionItem key={m.id} className="p-4 rounded-xl glass-panel group border border-white/40 dark:border-white/5 bg-white/50 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{m.name}</span>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-mono tracking-widest uppercase text-slate-400 bg-white dark:bg-black/40 px-2 py-0.5 rounded shadow-sm">{m.measure_key}</span>
                     {m.domain && <span className="text-xs text-slate-500">{m.domain}</span>}
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                   <span className="text-[10px] uppercase font-mono tracking-widest text-slate-400">Unit</span>
                   <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{m.unit ?? "—"}</span>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <LineChart className="h-6 w-6 text-emerald-500 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <h2 className="text-xl font-display font-semibold tracking-tight text-slate-800 dark:text-slate-100">Latest Facilities Telemetry</h2>
        </div>
        
        {noFacility || loading ? (
           <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : latest.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md max-w-xl mx-auto mt-8">
             <p className="font-medium">No Results.</p>
             <p className="text-sm opacity-80 mt-1">Import or enter results in a facility follow-up.</p>
          </div>
        ) : (
          <MotionList className="space-y-2">
            {latest.map((r) => (
              <MotionItem key={r.id ?? `${r.quality_measure_id}-${r.period_end}`} className="p-4 rounded-xl glass-panel group border border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20 hover:border-emerald-500/40 transition-colors flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{r.quality_measures?.name ?? r.quality_measure_id ?? "—"}</span>
                  <span className="text-xs text-slate-500 font-mono">
                    {r.period_start ?? "—"} <span className="opacity-50">→</span> {r.period_end ?? "—"}
                  </span>
                </div>
                <span className="text-xl font-mono font-medium text-emerald-700 dark:text-emerald-400 tabular-nums bg-white dark:bg-black/40 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900 shadow-sm">
                   {r.value_numeric != null ? String(r.value_numeric) : (r.value_text ?? "—")}
                </span>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-200">PBJ export batches</h2>
          </div>
        </div>
        
        {noFacility || loading ? (
          <p className="text-sm font-mono text-slate-500">Loading…</p>
        ) : pbjRows.length === 0 ? (
          <div className="p-4 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-xl border border-white/20 dark:border-white/5 backdrop-blur-md max-w-xl mx-auto mt-4 px-8 py-6">
             <p className="font-medium text-sm">No PBJ batches recorded.</p>
             <p className="text-xs opacity-80 mt-1">Generation ships in Enhanced.</p>
          </div>
        ) : (
          <MotionList className="space-y-2">
            {pbjRows.map((p) => (
              <MotionItem key={p.id} className="p-4 rounded-xl glass-panel group border border-white/20 dark:border-white/5 bg-white/60 dark:bg-slate-900/60 flex items-center justify-between">
                <div className="flex flex-col gap-1 w-1/3">
                  <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">Period</span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 font-mono tracking-tight">{p.period_start} → {p.period_end}</span>
                </div>
                <div className="flex flex-col gap-1 w-1/4">
                  <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">Status</span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 capitalize">{p.status.replace(/_/g, " ")}</span>
                </div>
                <div className="flex flex-col gap-1 w-1/4 items-end">
                  <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Rows</span>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300 tabular-nums">{p.row_count ?? "—"}</span>
                </div>
                <div className="flex flex-col gap-1 w-1/4 items-end">
                   <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Created</span>
                   <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{new Date(p.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-500 font-mono tracking-widest uppercase mt-4">
        <span>Dashboard:</span>
        <Link href={homeHref} className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-[10px] text-indigo-600 dark:text-indigo-400 leading-none pb-0.5")}>
          Back to dashboard
        </Link>
      </div>
      </div>
    </div>
  );
}
