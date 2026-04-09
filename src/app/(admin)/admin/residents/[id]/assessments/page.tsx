"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Plus } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

const TYPE_LABELS: Record<string, string> = {
  katz_adl: "Katz ADL",
  morse_fall: "Morse Fall Scale",
  braden: "Braden Scale",
  phq9: "PHQ-9",
};

function formatType(t: string): string {
  return TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const RISK_COLORS: Record<string, string> = {
  low: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  standard: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  high: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  level_1: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  level_2: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  level_3: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  none: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  mild: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  moderate: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  very_high: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  minimal: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  moderately_severe: "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  severe: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

type Row = {
  id: string;
  assessmentType: string;
  assessmentDate: string;
  totalScore: number | null;
  riskLevel: string | null;
  assessedBy: string;
};

export default function ResidentAssessmentHistoryPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Row[]>([]);
  const [residentName, setResidentName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const facilityFilter = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : undefined;

      // Fetch resident name
      const { data: resident } = await supabase
        .from("residents")
        .select("first_name, last_name")
        .eq("id", residentId)
        .maybeSingle();
      if (resident) setResidentName(`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim());

      // Fetch assessments
      let q = supabase
        .from("assessments")
        .select("id, assessment_type, assessment_date, total_score, risk_level, assessed_by")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("assessment_date", { ascending: false });

      if (facilityFilter) q = q.eq("facility_id", facilityFilter);

      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);

      // Fetch assessor names
      const userIds = [...new Set((data ?? []).map((a) => a.assessed_by).filter(Boolean))];
      const nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", userIds);
        for (const p of profiles ?? []) nameMap.set(p.id, p.full_name ?? "Staff");
      }

      setRows(
        (data ?? []).map((a) => ({
          id: a.id,
          assessmentType: a.assessment_type,
          assessmentDate: a.assessment_date,
          totalScore: typeof a.total_score === "number" ? a.total_score : null,
          riskLevel: a.risk_level,
          assessedBy: nameMap.get(a.assessed_by) ?? "Staff",
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assessments");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOptions = useMemo(() => {
    const types = [...new Set(rows.map((r) => r.assessmentType))].sort();
    return [{ value: "all", label: "All types" }, ...types.map((t) => ({ value: t, label: formatType(t) }))];
  }, [rows]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return rows;
    return rows.filter((r) => r.assessmentType === typeFilter);
  }, [rows, typeFilter]);

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
               Assessments <span className="font-semibold text-brand-600 dark:text-brand-400 opacity-60 ml-2">/ {residentName}</span>
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400">
               {rows.length} assessment{rows.length !== 1 ? "s" : ""} on record
            </p>
          </div>
          <div>
            <Link
              href={`/admin/residents/${residentId}/assessments/new`}
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg flex items-center gap-2")}
            >
              <Plus className="h-4 w-4" /> New Assessment
            </Link>
          </div>
        </header>

        <AdminFilterBar
          searchPlaceholder="Filter by type…"
          searchValue=""
          onSearchChange={() => {}}
          filters={[{ id: "type", value: typeFilter, onChange: setTypeFilter, options: typeOptions }]}
          onReset={() => setTypeFilter("all")}
        />

        {isLoading && <AdminTableLoadingState />}
        {error && <AdminLiveDataFallbackNotice message={error} onRetry={load} />}
        {!isLoading && !error && filtered.length === 0 && (
          <AdminEmptyState
            title="No assessments yet"
            description="Complete the first assessment to establish baseline scores."
          />
        )}
        
        {!isLoading && !error && filtered.length > 0 && (
          <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
             <div className="hidden lg:grid grid-cols-[auto_1fr_1fr_0.5fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-right first:text-left [&>*:nth-child(2)]:text-left [&>*:nth-child(3)]:text-left">
               <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-left min-w-[120px]">Date</div>
               <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2"><ClipboardCheck className="w-3.5 h-3.5 text-slate-400" /> Type</div>
               <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Risk Level</div>
               <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Score</div>
               <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Assessed By</div>
             </div>

             <div className="space-y-4 mt-6 relative z-10">
               <MotionList className="space-y-4">
               {filtered.map((r) => (
                  <MotionItem key={r.id}>
                    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_1fr_0.5fr_1fr] gap-4 lg:items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                      
                      <div className="flex flex-col min-w-[120px]">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Date</span>
                        <span className="font-mono text-sm text-slate-900 dark:text-slate-100">{r.assessmentDate}</span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Type</span>
                        <span className="font-semibold text-lg font-display text-slate-900 dark:text-white truncate tracking-tight">{formatType(r.assessmentType)}</span>
                      </div>
                      
                      <div className="flex flex-col items-start lg:items-start">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Risk Level</span>
                        {r.riskLevel ? (
                            <Badge className={cn("px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest shadow-none", RISK_COLORS[r.riskLevel] ?? "bg-slate-100 text-slate-600 border-slate-200")}>
                               {r.riskLevel.replace(/_/g, " ")}
                            </Badge>
                         ) : (
                            <span className="text-slate-400">—</span>
                         )}
                      </div>

                      <div className="flex flex-col lg:items-end">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Score</span>
                        <span className="font-display text-xl font-medium text-slate-900 dark:text-slate-100">{r.totalScore !== null ? r.totalScore : "—"}</span>
                      </div>

                      <div className="flex flex-row justify-between lg:justify-end items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Assessed By</span>
                        <span className="text-sm font-medium text-slate-500 dark:text-zinc-400">
                          {r.assessedBy}
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
    </div>
  );
}
