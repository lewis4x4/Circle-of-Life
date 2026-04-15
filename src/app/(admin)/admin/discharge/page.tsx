"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, DoorOpen, ArrowRight } from "lucide-react";

import { DischargeHubNav } from "./discharge-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type RowT = Pick<
  Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "nurse_reconciliation_notes"
  | "pharmacist_npi"
  | "pharmacist_notes"
> & {
  residents: { first_name: string; last_name: string; discharge_target_date: string | null; hospice_status: string } | null;
};

type DischargePhase = "planning" | "pharmacist_review" | "ready_to_complete" | "complete" | "cancelled";

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function describeDischargePhase(row: RowT): {
  phase: DischargePhase;
  helperText: string;
  nextActionLabel: string;
} {
  if (row.status === "cancelled") {
    return {
      phase: "cancelled",
      helperText: "Reconciliation cancelled.",
      nextActionLabel: "Cancelled",
    };
  }
  if (row.status === "complete") {
    return {
      phase: "complete",
      helperText: "Reconciliation and transition planning are complete.",
      nextActionLabel: "Complete",
    };
  }
  if (!row.residents?.discharge_target_date) {
    return {
      phase: "planning",
      helperText: "Set the resident discharge target date.",
      nextActionLabel: "Set discharge date",
    };
  }
  if (row.residents?.hospice_status === "pending") {
    return {
      phase: "planning",
      helperText: "Resolve hospice planning before transition completes.",
      nextActionLabel: "Confirm hospice",
    };
  }
  if (!row.nurse_reconciliation_notes?.trim()) {
    return {
      phase: "planning",
      helperText: "Add nurse reconciliation notes before pharmacist handoff.",
      nextActionLabel: "Add nurse notes",
    };
  }
  if (row.status === "draft") {
    return {
      phase: "pharmacist_review",
      helperText: "Ready to move into pharmacist review.",
      nextActionLabel: "Send to pharmacist",
    };
  }
  if (!row.pharmacist_npi?.trim() || !row.pharmacist_notes?.trim()) {
    return {
      phase: "pharmacist_review",
      helperText: "Awaiting pharmacist attestation fields.",
      nextActionLabel: "Finish pharmacist review",
    };
  }
  return {
    phase: "ready_to_complete",
    helperText: "Pharmacist review is in place; this can be completed.",
    nextActionLabel: "Mark complete",
  };
}

export default function AdminDischargeHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowT[]>([]);
  const [counts, setCounts] = useState({
    draft: 0,
    review: 0,
    complete: 0,
    cancelled: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ draft: 0, review: 0, complete: 0, cancelled: 0 });
      setLoading(false);
      return;
    }

    try {
      const { data: list, error: listErr } = await supabase
        .from("discharge_med_reconciliation")
        .select("id, status, updated_at, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(first_name, last_name, discharge_target_date, hospice_status)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (listErr) throw listErr;
      setRows((list ?? []) as RowT[]);

      const base = () =>
        supabase
          .from("discharge_med_reconciliation")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cDraft, cRev, cDone, cCan] = await Promise.all([
        base().eq("status", "draft"),
        base().eq("status", "pharmacist_review"),
        base().eq("status", "complete"),
        base().eq("status", "cancelled"),
      ]);

      setCounts({
        draft: cDraft.count ?? 0,
        review: cRev.count ?? 0,
        complete: cDone.count ?? 0,
        cancelled: cCan.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load reconciliations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);
  const featuredRows = useMemo(() => {
    const phaseOrder: Record<DischargePhase, number> = {
      planning: 0,
      pharmacist_review: 1,
      ready_to_complete: 2,
      complete: 3,
      cancelled: 4,
    };
    return [...rows]
      .sort((a, b) => {
        const phaseA = describeDischargePhase(a).phase;
        const phaseB = describeDischargePhase(b).phase;
        const phaseDelta = phaseOrder[phaseA] - phaseOrder[phaseB];
        if (phaseDelta !== 0) return phaseDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, 12);
  }, [rows]);
  const planningCount = rows.filter((row) => describeDischargePhase(row).phase === "planning").length;
  const pharmacistActionCount = rows.filter((row) => describeDischargePhase(row).phase === "pharmacist_review").length;
  const readyToCompleteCount = rows.filter((row) => describeDischargePhase(row).phase === "ready_to_complete").length;

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12 w-full">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Pipeline
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Discharge & Transition
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Medication reconciliation records and discharge planning.
           </p>
         </div>
         <div className="hidden md:block">
           <DischargeHubNav />
         </div>
      </div>

      {noFacility ? (
        <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm">
           <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <span className="font-bold">!</span>
           </div>
           Select a facility in the header to load reconciliation rows.
        </div>
      ) : null}

      {/* ─── METRIC PILLARS ─── */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 pt-4">
        <div className="h-[180px]">
           <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                 Draft
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.draft}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[0_8px_30px_rgba(245,158,11,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-amber-600 dark:text-amber-500 flex items-center gap-2">
                 Pharmacist Review
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.review}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                 Complete
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.complete}
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
        <V2Card href="/admin/discharge/new" hoverColor="indigo" className="border-indigo-500/20 pb-0">
          <div className="flex items-center gap-6 h-full absolute inset-0 px-8">
            <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 p-4 border border-indigo-100 dark:border-indigo-500/20">
              <DoorOpen className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-display text-xl lg:text-2xl font-medium tracking-tight text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                New Med Reconciliation
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 tracking-wide mt-1">Opens a draft row for a resident in this facility.</p>
            </div>
            <ArrowRight className="h-6 w-6 text-slate-300 dark:text-slate-700 ml-auto group-hover:text-indigo-500 transition-colors group-hover:translate-x-2 duration-300" />
          </div>
        </V2Card>
      </div>

      {!noFacility ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[1.5rem] border border-amber-200/70 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-4">
            <p className="text-[10px] uppercase tracking-widest font-mono text-amber-700 dark:text-amber-300">Planning gaps</p>
            <p className="mt-2 text-2xl font-display font-medium text-slate-900 dark:text-white">{loading ? "—" : planningCount}</p>
          </div>
          <div className="rounded-[1.5rem] border border-indigo-200/70 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20 p-4">
            <p className="text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300">Pharmacist action</p>
            <p className="mt-2 text-2xl font-display font-medium text-slate-900 dark:text-white">{loading ? "—" : pharmacistActionCount}</p>
          </div>
          <div className="rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20 p-4">
            <p className="text-[10px] uppercase tracking-widest font-mono text-emerald-700 dark:text-emerald-300">Ready to complete</p>
            <p className="mt-2 text-2xl font-display font-medium text-slate-900 dark:text-white">{loading ? "—" : readyToCompleteCount}</p>
          </div>
        </div>
      ) : null}

      {/* ─── CASE ROSTER (GLASS ROWS) ─── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white tracking-tight">
            Reconciliations
          </h3>
        </div>

        {loadError ? (
           <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">{loadError}</p>
        ) : null}

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />

           <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
           </div>

           <div className="space-y-4 mt-6 relative z-10">
             {noFacility ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Select a facility to view reconciliations.
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading queue...
               </div>
             ) : rows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No rows yet. Start with <strong>New med reconciliation</strong>.
               </div>
             ) : (
                <MotionList className="space-y-4">
                  {featuredRows.map((r) => {
                    const isDraft = r.status.includes('draft');
                    const phase = describeDischargePhase(r);
                    
                    return (
                      <MotionItem key={r.id}>
                        <Link
                          href={`/admin/discharge/${r.id}`}
                          className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 w-full cursor-pointer outline-none hover:shadow-lg dark:hover:bg-white/[0.05]"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                              {isDraft ? <PulseDot colorClass="bg-rose-500" /> : <div className="w-2 h-2 rounded-full bg-indigo-500" />}
                            </div>
                            <span className="font-semibold text-xl text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors tracking-tight font-display">
                               {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "—"}
                            </span>
                          </div>
                          
                          <div className="flex flex-row justify-between lg:justify-start items-center">
                            <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Status</span>
                            <span className={cn(
                              "text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner",
                              isDraft ? "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400"
                            )}>
                              {formatStatus(r.status)}
                            </span>
                            <span className={cn(
                              "text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner",
                              phase.phase === "planning"
                                ? "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300"
                                : phase.phase === "pharmacist_review"
                                  ? "bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300"
                                  : phase.phase === "ready_to_complete"
                                    ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300"
                                    : phase.phase === "cancelled"
                                      ? "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300"
                                      : "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300"
                            )}>
                              {phase.nextActionLabel}
                            </span>
                          </div>

                          <div className="flex flex-row justify-between lg:justify-end items-center">
                            <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Updated</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] font-mono tracking-wide text-slate-500 dark:text-zinc-500">
                                {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                              </span>
                              <span className={cn(
                                "mt-1 text-[11px]",
                                phase.phase === "planning"
                                  ? "text-amber-700 dark:text-amber-300"
                                  : phase.phase === "pharmacist_review"
                                    ? "text-indigo-700 dark:text-indigo-300"
                                    : phase.phase === "ready_to_complete"
                                      ? "text-emerald-700 dark:text-emerald-300"
                                      : "text-slate-600 dark:text-zinc-400",
                              )}>
                                {phase.helperText}
                              </span>
                            </div>
                          </div>
                        </Link>
                      </MotionItem>
                    )
                  })}
                </MotionList>
             )}
           </div>
        </div>
      </div>
      
    </div>
  );
}
