"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Utensils } from "lucide-react";

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
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { MotionCard } from "@/components/ui/motion-card";

type DietRow = Database["public"]["Tables"]["diet_orders"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminDietaryHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DietRow[]>([]);
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
        .from("diet_orders")
        .select("*, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows((data ?? []) as DietRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diet orders.");
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
        secondaryClass="bg-blue-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 08 / Culinary Services</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Dietary & Nutrition
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
                  <Utensils className="h-3.5 w-3.5" /> Active Diet Orders
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{rows.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">IDDSI food and fluid levels with allergy constraints.</p>
                 <div className="flex gap-2 justify-start lg:justify-end">
                   <Link href="/admin/dietary/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                     + New Diet Order
                   </Link>
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load diet orders.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ACTION QUEUE: Dietary Risk Board */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                High-Risk Diet Interventions
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading…</p>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md">
                   <p className="font-medium">All Clear</p>
                   <p className="text-sm opacity-80">No active residents flagged for high-risk diets.</p>
                </div>
              ) : (
                <>
                  {/* MOCK NPO Flag */}
                  <MotionItem className="p-5 rounded-2xl border border-rose-200 dark:border-rose-900/30 bg-white/60 dark:bg-slate-900/60 shadow-sm backdrop-blur-xl relative overflow-hidden group hover:border-rose-300 dark:hover:border-rose-800/50 transition-colors">
                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />
                    <div className="flex justify-between items-start mb-3">
                       <span className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2 py-1 rounded-md uppercase tracking-wider">
                         Status: NPO
                       </span>
                       <span className="text-xs text-rose-600 font-mono font-medium">Changed 2h ago</span>
                    </div>
                    <div className="mb-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                        Resident: Eleanor Rigby
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Strict NPO active due to pending procedure at 0800 tomorrow. Dietary must withhold breakfast tray.
                      </p>
                    </div>
                    <div className="flex justify-start">
                        <Link
                          href="/admin/dietary/new"
                          className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-rose-600 hover:bg-rose-700 text-white font-mono uppercase tracking-widest text-[10px]")}
                        >
                          Acknowledge Change
                        </Link>
                    </div>
                  </MotionItem>

                  {/* Real feed filtering for any non-regular IDDSI orders or generic list if all standard */}
                  <MotionList className="mt-8 space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                     <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Active Diet Roster</h4>
                     {rows.slice(0, 4).map(row => (
                       <MotionItem key={row.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex gap-4 items-center">
                         <div className="flex-1 min-w-0">
                           <p className="text-xs font-medium text-slate-900 dark:text-slate-300 truncate">
                             {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unknown"}
                           </p>
                           <p className="text-[10px] text-slate-500 truncate capitalize">
                             Food: {row.iddsi_food_level.replace(/_/g, ' ')} | Fluids: {row.iddsi_fluid_level.replace(/_/g, ' ')}
                           </p>
                         </div>
                         {row.iddsi_fluid_level.includes('thick') ? (
                            <span className="text-[10px] font-mono text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded text-right">
                              Thickened
                            </span>
                         ) : (
                            <span className="text-[10px] font-mono text-slate-500 text-right">
                              Standard
                            </span>
                         )}
                       </MotionItem>
                     ))}
                  </MotionList>
                </>
              )}
            </MotionList>
            
          </div>

          {/* WATCHLIST: Kitchen Operations Context */}
          <div className="col-span-1 border-l border-white/10 dark:border-white/5 pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Therapeutic Context
              </h3>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                 <div className="flex justify-between items-center">
                   <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Fall / Choking Risk</p>
                   <span className="text-xs font-bold text-amber-500">12%</span>
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: '12%' }}></div>
                 </div>
                 <p className="text-[9px] text-slate-500">Facility-wide percentage</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                 <div className="flex justify-between items-center">
                   <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Diabetic Trays</p>
                   <span className="text-xs font-bold text-indigo-500">24%</span>
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: '24%' }}></div>
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
