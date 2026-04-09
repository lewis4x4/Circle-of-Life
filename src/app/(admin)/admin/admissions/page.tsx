"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Home, ArrowRight } from "lucide-react";

import { AdmissionsHubNav } from "./admissions-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  "id" | "status" | "updated_at" | "target_move_in_date"
> & {
  residents: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminAdmissionsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [counts, setCounts] = useState({
    pending: 0,
    reserved: 0,
    moveIn: 0,
    cancelled: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ pending: 0, reserved: 0, moveIn: 0, cancelled: 0 });
      setLoading(false);
      return;
    }

    try {
      const { data: list, error: listErr } = await supabase
        .from("admission_cases")
        .select("id, status, updated_at, target_move_in_date, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (listErr) throw listErr;
      setRows((list ?? []) as CaseRow[]);

      const base = () =>
        supabase
          .from("admission_cases")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cPend, cRes, cMove, cCan] = await Promise.all([
        base().eq("status", "pending_clearance"),
        base().eq("status", "bed_reserved"),
        base().eq("status", "move_in"),
        base().eq("status", "cancelled"),
      ]);

      setCounts({
        pending: cPend.count ?? 0,
        reserved: cRes.count ?? 0,
        moveIn: cMove.count ?? 0,
        cancelled: cCan.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load admission cases.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12 w-full">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Pipeline
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Admissions
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Clearance, bed reservation, and move-in tracking.
           </p>
         </div>
         <div className="hidden md:block">
           <AdmissionsHubNav />
         </div>
      </div>

      {noFacility ? (
        <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm">
           <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <span className="font-bold">!</span>
           </div>
           Select a facility in the header to load admission cases.
        </div>
      ) : null}

      {/* ─── METRIC PILLARS ─── */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 pt-4">
        <div className="h-[180px]">
           <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                 Pending Clearance
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.pending}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[0_8px_30px_rgba(245,158,11,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-amber-600 dark:text-amber-500 flex items-center gap-2">
                 Bed Reserved
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.reserved}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                 Move-In Ready
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.moveIn}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="slate" className="border-slate-500/20 shadow-sm">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 flex items-center gap-2">
                 Cancelled
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.cancelled}
               </p>
             </div>
           </V2Card>
        </div>
      </div>

      <div className="h-[120px]">
        <V2Card href="/admin/admissions/new" hoverColor="indigo" className="border-indigo-500/20 pb-0">
          <div className="flex items-center gap-6 h-full absolute inset-0 px-8">
            <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 p-4 border border-indigo-100 dark:border-indigo-500/20">
              <Home className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-display text-xl lg:text-2xl font-medium tracking-tight text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                New Admission Case
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 tracking-wide mt-1">Link a resident prospect to clearance and bed planning.</p>
            </div>
            <ArrowRight className="h-6 w-6 text-slate-300 dark:text-slate-700 ml-auto group-hover:text-indigo-500 transition-colors group-hover:translate-x-2 duration-300" />
          </div>
        </V2Card>
      </div>

      {/* ─── CASE ROSTER (GLASS ROWS) ─── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white tracking-tight">
            Active Cases
          </h3>
        </div>

        {loadError ? (
           <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">{loadError}</p>
        ) : null}

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-sm backdrop-blur-3xl overflow-hidden p-4 md:p-6 lg:p-8">
           
           <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5">
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Target Move-in</div>
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
           </div>

           <div className="space-y-3 mt-4">
             {noFacility ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Select a facility to view cases.
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading queue...
               </div>
             ) : rows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No cases yet. Start with <strong>New admission case</strong>.
               </div>
             ) : (
                rows.map((r) => {
                  const isPending = r.status.includes('pending');
                  
                  return (
                    <Link
                      key={r.id} 
                      href={`/admin/admissions/${r.id}`}
                      className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center p-5 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-colors w-full cursor-pointer outline-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                          {isPending ? <PulseDot colorClass="bg-rose-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                        </div>
                        <span className="font-semibold text-lg text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors tracking-tight">
                           {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "—"}
                        </span>
                      </div>
                      
                      <div className="flex flex-row justify-between lg:justify-start items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Status</span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded border leading-none pt-1",
                          isPending ? "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400"
                        )}>
                          {formatStatus(r.status)}
                        </span>
                      </div>
                      
                      <div className="flex flex-row justify-between lg:justify-end items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Target</span>
                        <span className="text-base font-display text-slate-700 dark:text-zinc-300">
                          {r.target_move_in_date ?? "—"}
                        </span>
                      </div>

                      <div className="flex flex-row justify-between lg:justify-end items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Updated</span>
                        <span className="text-sm font-medium text-slate-500 dark:text-zinc-500">
                          {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </div>
                    </Link>
                  )
                })
             )}
           </div>
        </div>
      </div>
      
    </div>
  );
}
