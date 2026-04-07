"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Bus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type FleetRow = Database["public"]["Tables"]["fleet_vehicles"]["Row"];
type InspectionRow = Database["public"]["Tables"]["vehicle_inspection_logs"]["Row"] & {
  fleet_vehicles: { name: string } | null;
};
type DriverRow = Database["public"]["Tables"]["driver_credentials"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

function formatEnum(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminTransportationHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFleet([]);
      setInspections([]);
      setDrivers([]);
      setLoading(false);
      return;
    }
    try {
      const [fRes, iRes, dRes] = await Promise.all([
        supabase
          .from("fleet_vehicles")
          .select("*")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(40),
        supabase
          .from("vehicle_inspection_logs")
          .select("*, fleet_vehicles(name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("inspected_at", { ascending: false })
          .limit(25),
        supabase
          .from("driver_credentials")
          .select("*, staff(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(40),
      ]);
      if (fRes.error) throw fRes.error;
      if (iRes.error) throw iRes.error;
      if (dRes.error) throw dRes.error;
      setFleet(fRes.data ?? []);
      setInspections((iRes.data ?? []) as InspectionRow[]);
      setDrivers((dRes.data ?? []) as DriverRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transportation data.");
      setFleet([]);
      setInspections([]);
      setDrivers([]);
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
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 19 / Site Logistics</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Fleet Operations
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={fleet.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <Bus className="h-3.5 w-3.5" /> Fleet Size
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{fleet.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              <Sparkline colorClass="text-slate-400" variant={1} />
              <MonolithicWatermark value={drivers.length} className="text-slate-800/5 dark:text-white/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 flex items-center gap-2">
                   Active Drivers
                </h3>
                <p className="text-4xl font-mono tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-500 pb-1">{drivers.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Fleet units, periodic inspections, and driver credentials.</p>
                 <div className="flex gap-2 justify-start lg:justify-end">
                   <Link href="/admin/transportation/vehicles/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                     + Vehicle
                   </Link>
                   <Link href="/admin/transportation/inspections/new" className={cn(buttonVariants({ variant: "outline" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800")} >
                     + Inspection
                   </Link>
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load fleet and driver records.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* ACTION QUEUE: Credential & Insurance Expiries */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Compliance Blockers
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading…</p>
              ) : drivers.length === 0 && fleet.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md">
                   <p className="font-medium">Inbox Zero</p>
                   <p className="text-sm opacity-80">All drivers and fleet vehicles compliant.</p>
                </div>
              ) : (
                <>
                  {/* MOCK Expiring Driver */}
                  <MotionItem className="p-5 rounded-2xl border border-red-200 dark:border-red-900/30 bg-white/60 dark:bg-slate-900/60 shadow-sm backdrop-blur-xl relative overflow-hidden group hover:border-red-300 dark:hover:border-red-800/50 transition-colors">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                    <div className="flex justify-between items-start mb-3">
                       <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-1 rounded-md uppercase tracking-wider">
                         Grounded
                       </span>
                       <span className="text-xs text-slate-500 font-mono font-medium">Expired 2 days ago</span>
                    </div>
                    <div className="mb-4">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                        Driver: Marcus Johnson
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        DOT Medical Card expired on {format(new Date(), "MMM d")}. Driver cannot be scheduled for transport shifts.
                      </p>
                    </div>
                    <div className="flex justify-start">
                        <Link
                          href="/admin/staff"
                          className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-red-600 hover:bg-red-700 text-white font-mono uppercase tracking-widest text-[10px]")}
                        >
                          Message Staff Member
                        </Link>
                    </div>
                  </MotionItem>
                  
                  {/* Real drivers list - read only */}
                  <MotionList className="mt-8 space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                     <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Active Drivers</h4>
                     {drivers.slice(0, 3).map(row => (
                       <MotionItem key={row.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex gap-4 items-center">
                         <div className="flex-1 min-w-0">
                           <p className="text-xs font-medium text-slate-900 dark:text-slate-300 truncate">
                             {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Unknown"}
                           </p>
                           <p className="text-[10px] text-slate-500 truncate capitalize">License: {row.license_expires_on ? format(new Date(row.license_expires_on), 'MMM yyyy') : 'No data'}</p>
                         </div>
                         <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 text-right">
                           {formatEnum(row.status)}
                         </span>
                       </MotionItem>
                     ))}
                  </MotionList>
                </>
              )}
            </MotionList>
            
          </div>

          {/* WATCHLIST: Fleet Inspections */}
          <div className="space-y-4 lg:pl-6 lg:border-l border-white/10 dark:border-white/5 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Fleet Readiness
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {/* MOCK Overdue Inspection */}
              <MotionItem className="p-5 rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-white/60 dark:bg-slate-900/60 shadow-sm backdrop-blur-xl relative overflow-hidden group hover:border-amber-300 dark:hover:border-amber-800/50 transition-colors">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                <div className="flex justify-between items-start mb-3">
                   <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-1 rounded-md uppercase tracking-wider">
                     Inspection Overdue
                   </span>
                   <span className="text-xs text-amber-600 font-mono font-medium">Overdue by 72h</span>
                </div>
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                     Shuttle Bus (V-02)
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Weekly walk-around and fluids check was due on Monday.
                  </p>
                </div>
                <div className="flex justify-start">
                    <Link
                      href="/admin/transportation/inspections/new"
                      className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-amber-600 hover:bg-amber-700 text-white font-mono uppercase tracking-widest text-[10px]")}
                    >
                      Log Inspection
                    </Link>
                </div>
              </MotionItem>

              {/* Real historical inspections */}
              <MotionList className="mt-8 space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                 <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Recent Logs</h4>
                 {inspections.slice(0, 3).map(row => (
                   <MotionItem key={row.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-black/20 flex gap-4 items-center">
                     <div className="flex-1 min-w-0">
                       <p className="text-xs font-medium text-slate-900 dark:text-slate-300 truncate">
                         {row.fleet_vehicles?.name ?? "Unknown"}
                       </p>
                       <p className="text-[10px] text-slate-500 truncate capitalize">Result: {formatEnum(row.result)}</p>
                     </div>
                     <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 text-right">
                       {format(new Date(row.inspected_at), "MMM d")}
                     </span>
                   </MotionItem>
                 ))}
                 {inspections.length === 0 && !loading && (
                   <p className="text-xs text-slate-500 italic">No historical inspections.</p>
                 )}
              </MotionList>
            </MotionList>
            
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
