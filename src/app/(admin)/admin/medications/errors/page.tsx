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
  error_type: string;
  severity: string;
  occurred_at: string;
  reviewed_at: string | null;
};

export default function AdminMedicationErrorsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<{ n: number; bySeverity: Record<string, number> }>({
    n: 0,
    bySeverity: {},
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setTotals({ n: 0, bySeverity: {} });
      setLoading(false);
      setError("Select a facility.");
      return;
    }
    try {
      const res = await supabase
        .from("medication_errors")
        .select("id, error_type, severity, occurred_at, reviewed_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(150);

      if (res.error) throw res.error;
      const list = (res.data ?? []) as Row[];
      setRows(list);
      const bySeverity: Record<string, number> = {};
      for (const r of list) {
        bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      }
      setTotals({ n: list.length, bySeverity });
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-100 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-400 mb-2 block w-fit">
              Error Reporting
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white">
            Medication Errors
          </h1>
          <p className="text-sm font-medium tracking-wide text-slate-600 dark:text-slate-400 mt-2">
            Structured reports (aggregate view — no staff names on charts).
          </p>
        </div>
        <Link href="/admin/medications/errors/new" className={cn(buttonVariants(), "h-12 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-rose-600 hover:bg-rose-700 shadow-md text-white")} >
          Report Error
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs font-medium uppercase text-slate-500">In view</p>
          <p className="font-display text-2xl font-semibold">{totals.n}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 sm:col-span-2">
          <p className="text-xs font-medium uppercase text-slate-500">By severity in view</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {Object.entries(totals.bySeverity).length === 0
              ? "—"
              : Object.entries(totals.bySeverity)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <div className="rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] p-16 text-center backdrop-blur-3xl shadow-sm">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">No Errors Found</p>
          <p className="text-sm font-medium text-slate-500 dark:text-zinc-500 mt-1">There are no medication errors logged for this facility.</p>
        </div>
      ) : (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] p-6 md:p-8 shadow-sm backdrop-blur-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
          
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Type</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Severity</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Occurred</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 lg:text-right">Reviewed</div>
          </div>

          <div className="relative z-10 space-y-4 mt-6">
            <MotionList className="space-y-4">
              {rows.map((r) => (
                <MotionItem key={r.id}>
                  <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-rose-200 dark:hover:border-rose-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                    
                    <div className="flex flex-col min-w-0 pr-4">
                      <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Type</span>
                      <span className="font-semibold text-lg text-slate-900 dark:text-white capitalize tracking-tight group-hover:text-rose-700 dark:group-hover:text-rose-400 transition-colors">
                        {r.error_type.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Severity</span>
                      <Badge variant="outline" className={cn("capitalize px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest shadow-sm w-fit",
                        r.severity === "critical" ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20" :
                        r.severity === "high" ? "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" :
                        "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20"
                      )}>
                        {r.severity.replace(/_/g, " ")}
                      </Badge>
                    </div>

                    <div className="flex flex-col">
                      <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Occurred</span>
                      <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                        {new Date(r.occurred_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex flex-col lg:items-end lg:pr-2">
                      <span className="lg:hidden text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Reviewed</span>
                      <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                        {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : "—"}
                      </span>
                    </div>

                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        </div>
      )}
    </div>
  );
}
