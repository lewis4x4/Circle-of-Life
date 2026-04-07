"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { GraduationCap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type DemoRow = Database["public"]["Tables"]["competency_demonstrations"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminTrainingHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DemoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("competency_demonstrations")
        .select("*, staff(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("demonstrated_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows((data ?? []) as DemoRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competency demonstrations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 05 / Academy</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Training & Competency
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={rows.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5" /> Demos Completed
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{rows.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Documented skills demonstrations for the selected facility.</p>
                 <div className="flex gap-2 justify-start lg:justify-end">
                   <Link href="/admin/training/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                     + New Demonstration
                   </Link>
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load competency demonstrations.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ACTION QUEUE: Pending Evaluations / Overdue Skills */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Pending Evaluations & Overdue Skills
              </h3>
            </div>
            
            <div className="space-y-3">
              {/* MOCKED OVERDUE EXCEPTIONS */}
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading…</p>
              ) : (
                <>
                  <div className="p-5 rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-white/60 dark:bg-slate-900/60 shadow-sm backdrop-blur-xl relative overflow-hidden group hover:border-amber-300 dark:hover:border-amber-800/50 transition-colors">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                    <div className="flex justify-between items-start mb-3">
                       <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-1 rounded-md uppercase tracking-wider">
                         Needs Evaluator
                       </span>
                       <span className="text-xs text-amber-600 font-mono font-medium">Overdue by 3 days</span>
                    </div>
                    <div className="mb-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                        John Doe (CNA) — Med Pass Demonstration
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Requested by shift supervisor on {format(new Date(), "MMM d")}. Evaluator sign-off pending.
                      </p>
                    </div>
                    <div className="flex justify-start">
                        <Link
                          href="/admin/training/new"
                          className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-amber-600 hover:bg-amber-700 text-white font-mono uppercase tracking-widest text-[10px]")}
                        >
                          Begin Evaluation
                        </Link>
                    </div>
                  </div>
                  
                  {/* Historical feed below the active mock items */}
                  {rows.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md">
                       <p className="font-medium">No Recent Historical Data</p>
                    </div>
                  ) : (
                    <div className="mt-8 space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                       <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Recently Completed</h4>
                       {rows.slice(0, 3).map(row => (
                         <div key={row.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex gap-4 items-center">
                           <div className="flex-1 min-w-0">
                             <p className="text-xs font-medium text-slate-900 dark:text-slate-300 truncate">
                               {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Unknown"}
                             </p>
                             <p className="text-[10px] text-slate-500 truncate capitalize">Status: {formatStatus(row.status)}</p>
                           </div>
                           <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 text-right">
                             {format(new Date(row.demonstrated_at), "MMM d")}
                           </span>
                         </div>
                       ))}
                    </div>
                  )}
                </>
              )}
            </div>
            
          </div>

          {/* WATCHLIST: Compliance Tracking */}
          <div className="col-span-1 border-l border-white/10 dark:border-white/5 pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Skills Compliance
              </h3>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                 <div className="flex justify-between items-center">
                   <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Annual Core Certs</p>
                   <span className="text-xs font-bold text-emerald-600">92%</span>
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '92%' }}></div>
                 </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                 <div className="flex justify-between items-center">
                   <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Dementia Tier 1</p>
                   <span className="text-xs font-bold text-amber-500">68%</span>
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: '68%' }}></div>
                 </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                 <div className="flex justify-between items-center">
                   <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Infection Control</p>
                   <span className="text-xs font-bold text-rose-500">42%</span>
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: '42%' }}></div>
                 </div>
              </div>
            </div>
            
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
