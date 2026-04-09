"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { format, parseISO } from "date-fns";

type Row = {
  id: string;
  staff_id: string;
  reported_date: string;
  illness_type: string;
  absent_from: string;
  absent_to: string | null;
  return_cleared: boolean;
  staff: { first_name: string; last_name: string } | null;
};

export default function StaffIllnessListPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from("staff_illness_records")
        .select("id, staff_id, reported_date, illness_type, absent_from, absent_to, return_cleared, staff(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("reported_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows((data ?? []) as unknown as Row[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={rows.some(r => !r.return_cleared)} 
        primaryClass="bg-red-700/10"
        secondaryClass="bg-amber-500/10"
      />
      
      <div className="relative z-10 space-y-6 max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <Link href="/admin/infection-control" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs text-slate-500 mb-2 uppercase tracking-widest font-bold")}>
              ← Infection control
            </Link>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Staff Illness {rows.some(r => !r.return_cleared) && <PulseDot colorClass="bg-red-500" />}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Track absences, symptoms, and return-to-work clearances for your workforce.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/infection-control/staff-illness/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold uppercase tracking-widest text-[10px] tap-responsive bg-red-600 hover:bg-red-700 text-white shadow-lg")} >
               + Log Illness
            </Link>
          </div>
        </header>

        <div className="glass-panel p-6 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
           <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-white/5 pl-2">
             <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
               Recent Surveillance Records
             </h3>
             <span className="text-xs font-medium text-slate-500">{loading ? "Loading…" : `${rows.length} shown`}</span>
           </div>

           <MotionList className="space-y-3">
             {loading ? (
               <p className="text-sm font-mono text-slate-500 pl-2">Loading records…</p>
             ) : rows.length === 0 ? (
               <div className="p-12 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                  <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">All Clear</p>
                 <p className="text-sm opacity-80 mt-1">No staff illnesses reported recently.</p>
               </div>
             ) : (
               rows.map((r) => {
                 const name = r.staff ? `${r.staff.first_name} ${r.staff.last_name}` : "Unknown Staff";
                 const stillOut = !r.return_cleared;
                 const formatD = (d: string) => format(parseISO(d.length <= 10 ? `${d}T12:00:00.000Z` : d), "MMM d, yyyy");
                 return (
                   <MotionItem
                     key={r.id}
                     className={cn(
                       "p-5 rounded-[1.5rem] border shadow-sm flex flex-col sm:flex-row gap-4 sm:items-center justify-between group overflow-hidden relative transition-colors",
                       stillOut 
                         ? "border-red-200/80 bg-white dark:border-red-900/30 dark:bg-red-950/20 hover:border-red-300 dark:hover:border-red-800/40"
                         : "border-slate-200/80 bg-white dark:border-white/5 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20"
                     )}
                   >
                     {stillOut && <div className="absolute left-0 top-0 w-1.5 h-full bg-red-500" />}
                     <div className="flex-1 min-w-0 pl-1">
                       <div className="flex items-center gap-3 mb-1">
                         <span className={cn(
                           "text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border",
                           stillOut 
                             ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20" 
                             : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                         )}>
                           {stillOut ? "Absent / Pending Clearance" : "Cleared to work"}
                         </span>
                         <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                           Reported {formatD(r.reported_date)}
                         </span>
                       </div>
                       <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight mt-2">{name}</p>
                       <p className="text-sm font-medium text-slate-600 dark:text-slate-400 capitalize mt-1 flex items-center gap-2">
                         <span className="text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md text-xs">{r.illness_type}</span>
                         Absence: {formatD(r.absent_from)} {r.absent_to ? `→ ${formatD(r.absent_to)}` : "→ Present"}
                       </p>
                     </div>
                     <div className="shrink-0 flex items-center gap-3 pl-1 sm:pl-0">
                       <Link
                         href={`/admin/staff/${r.staff_id}`}
                         className={cn(
                           buttonVariants({ variant: "outline", size: "sm" }),
                           "h-10 rounded-full px-5 font-bold uppercase tracking-widest text-[10px] bg-white dark:bg-white/5 dark:border-white/10"
                         )}
                       >
                         View Staff
                       </Link>
                     </div>
                   </MotionItem>
                 );
               })
             )}
           </MotionList>
        </div>
      </div>
    </div>
  );
}
