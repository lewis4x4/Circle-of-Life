"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type Row = {
  id: string;
  count_date: string;
  shift: string;
  expected_count: number;
  actual_count: number;
  discrepancy: number;
  discrepancy_resolved: boolean | null;
  resident_medications: { medication_name: string } | null;
};

export default function AdminControlledSubstancesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility.");
      return;
    }
    try {
      const res = await supabase
        .from("controlled_substance_counts")
        .select(
          `
          id,
          count_date,
          shift,
          expected_count,
          actual_count,
          discrepancy,
          discrepancy_resolved,
          resident_medications ( medication_name )
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("count_date", { ascending: false })
        .limit(200);

      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as Row[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
        <div className="space-y-2">
          <Link
            href="/admin/medications"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0 text-slate-500 hover:bg-transparent hover:text-slate-900 dark:hover:text-white")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Medications
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-2 block w-fit">
              Narcotics Log
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white">
            Controlled Substances
          </h1>
          <p className="text-sm font-medium tracking-wide text-slate-600 dark:text-slate-400 mt-2">
            Shift reconciliation audit trail. Discrepancies highlight until resolved.
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <div className="rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] p-16 text-center backdrop-blur-3xl shadow-sm">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">No Count Records</p>
          <p className="text-sm font-medium text-slate-500 dark:text-zinc-500 mt-1">There are no controlled substance counts logged for this facility.</p>
        </div>
      ) : (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] p-6 md:p-8 shadow-sm backdrop-blur-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
          
          <div className="hidden lg:grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Medication</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Date & Shift</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-center">Expected</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-center">Actual</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-center">Delta</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Resolved</div>
          </div>

          <div className="relative z-10 space-y-4 mt-6">
            <MotionList className="space-y-4">
              {rows.map((r) => {
                const medName = r.resident_medications?.medication_name ?? "—";
                const hot = r.discrepancy !== 0 && !r.discrepancy_resolved;
                return (
                  <MotionItem key={r.id}>
                    <div className={cn(
                      "grid grid-cols-1 lg:grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-emerald-200 dark:hover:border-emerald-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none",
                      hot && "ring-1 ring-red-500/50 bg-red-50/50 dark:bg-red-500/5 hover:ring-red-500 dark:hover:ring-red-500"
                    )}>
                      
                      <div className="flex flex-col min-w-0 pr-4">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Medication</span>
                        <span className={cn(
                          "font-semibold text-lg text-slate-900 dark:text-white tracking-tight transition-colors",
                          hot ? "text-red-700 dark:text-red-400" : "group-hover:text-emerald-700 dark:group-hover:text-emerald-400"
                        )}>
                          {medName}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Date & Shift</span>
                        <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                          {r.count_date}
                        </span>
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1">
                          {r.shift} Shift
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Expected</span>
                        <span className="text-lg font-display text-slate-600 dark:text-slate-400">{r.expected_count}</span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Actual</span>
                        <span className="text-lg font-display text-slate-900 dark:text-slate-200">{r.actual_count}</span>
                      </div>

                      <div className="flex flex-col lg:items-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Delta</span>
                        <span className={cn(
                          "text-lg font-display font-medium",
                          hot ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                        )}>
                          {r.discrepancy > 0 ? `+${r.discrepancy}` : r.discrepancy}
                        </span>
                      </div>

                      <div className="flex flex-col lg:items-end lg:pr-2 justify-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Resolved</span>
                        {hot ? (
                          <Badge variant="destructive" className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400">Open</Badge>
                        ) : (
                          <Badge variant="secondary" className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">OK</Badge>
                        )}
                      </div>

                    </div>
                  </MotionItem>
                );
              })}
            </MotionList>
          </div>
        </div>
      )}
    </div>
  );
}
