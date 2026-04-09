"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pill } from "lucide-react";

import { AdminTableLoadingState, AdminEmptyState, AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { ShieldAlert } from "lucide-react";

type Med = {
  id: string;
  medication_name: string;
  strength: string | null;
  route: string;
  frequency: string;
  scheduled_times: string[] | null;
  status: string;
  prescriber_name: string | null;
  start_date: string;
  controlled_schedule: string;
};

export default function AdminResidentMedicationsPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<"active" | "discontinued" | "all">("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [residentName, setResidentName] = useState<string>("");
  const [rows, setRows] = useState<Med[]>([]);

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await supabase
        .from("residents")
        .select("first_name, last_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (r.data) {
        setResidentName([r.data.first_name, r.data.last_name].filter(Boolean).join(" ") || "Resident");
      }

      const q = supabase
        .from("resident_medications")
        .select(
          "id, medication_name, strength, route, frequency, scheduled_times, status, prescriber_name, start_date, controlled_schedule",
        )
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("medication_name");

      const res = await q;
      if (res.error) throw res.error;
      setRows((res.data ?? []) as Med[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load medications");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    if (tab === "active") return rows.filter((m) => m.status === "active");
    return rows.filter((m) => m.status === "discontinued");
  }, [rows, tab]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href={`/admin/residents/${residentId}`}
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO PROFILE
             </Link>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Medications <span className="font-semibold text-brand-600 dark:text-brand-400 opacity-60 ml-2">/ {residentName}</span>
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400">
               Current prescriptions and active orders.
            </p>
          </div>
          <div>
            <Link
              href="/admin/medications/verbal-orders/new"
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg flex items-center gap-2")}
            >
              New verbal order
            </Link>
          </div>
        </header>

      <div className="flex gap-2">
        {(["active", "discontinued", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-[1rem] px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all",
              tab === t
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-md"
                : "bg-white/60 dark:bg-slate-900/40 text-slate-500 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative mt-4">
          
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-3">
              <Pill className="h-5 w-5 text-brand-500" />
              Medication List
            </h3>
            <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
              Active orders and schedules
            </p>
          </div>

          <div className="relative z-10 w-full overflow-hidden">
            {filtered.length === 0 ? (
              <AdminEmptyState title="No medications found" description="No medications match the current filter." />
            ) : (
              <>
                 <div className="hidden lg:grid grid-cols-[1.5fr_1fr_2fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Medication</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Route</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Frequency & Schedule</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Prescriber</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Dates</div>
                 </div>

                 <div className="space-y-4 mt-6 relative z-10">
                   <MotionList className="space-y-4">
                     {filtered.map((m) => (
                       <MotionItem key={m.id}>
                         <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_2fr_1fr_1fr] gap-4 lg:items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                           
                           <div className="flex flex-col relative w-full">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Medication</span>
                             {m.controlled_schedule !== "non_controlled" && (
                                <ShieldAlert className="absolute -top-2 -left-2 lg:static lg:mb-1 w-4 h-4 text-rose-500" />
                             )}
                             <span className="font-semibold text-lg text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{m.medication_name}</span>
                             <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{m.strength ?? "—"}</span>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Route</span>
                             <span className="text-sm font-medium capitalize text-slate-800 dark:text-slate-300">{m.route.replace(/_/g, " ")}</span>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Frequency & Schedule</span>
                             <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{m.frequency.replace(/_/g, " ")}</span>
                             {m.scheduled_times?.length ? (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                   {m.scheduled_times.map(t => (
                                     <span key={t} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[9px] font-mono tracking-widest text-slate-600 dark:text-slate-400">{t}</span>
                                   ))}
                                </div>
                             ) : null}
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Prescriber</span>
                             <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{m.prescriber_name ?? "—"}</span>
                           </div>

                           <div className="flex flex-col lg:items-end">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Dates</span>
                             <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500">START</span>
                             <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{m.start_date}</span>
                             {m.status !== "active" && (
                                <Badge className="mt-2 bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border-none shadow-none uppercase font-bold text-[9px] tracking-widest">{m.status}</Badge>
                             )}
                           </div>

                         </div>
                       </MotionItem>
                     ))}
                   </MotionList>
                 </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
