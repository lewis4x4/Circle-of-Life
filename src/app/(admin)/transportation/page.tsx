"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Bus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

      <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
        <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
          <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Fleet</h3>
          <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Active vans and shuttles registered for this site.</p>
        </div>
        <div className="relative z-10 overflow-x-auto p-4">
          {loading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : !facilityReady ? null : fleet.length === 0 ? (
            <p className="text-sm font-mono text-slate-500">No vehicles yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Insurance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fleet.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer group">
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="capitalize">{formatEnum(row.status)}</TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">{row.license_plate ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.passenger_capacity ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {row.insurance_expires_on ? format(new Date(row.insurance_expires_on), "MMM d, yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
        <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
          <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Recent inspections</h3>
          <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Latest logged walk-arounds and safety checks.</p>
        </div>
        <div className="relative z-10 overflow-x-auto p-4">
          {loading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : !facilityReady ? null : inspections.length === 0 ? (
            <p className="text-sm font-mono text-slate-500">No inspections logged yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Vehicle</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Odometer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-amber-500/5 dark:hover:bg-amber-500/10 transition-colors cursor-pointer group">
                    <TableCell className="text-sm">{row.fleet_vehicles?.name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {format(new Date(row.inspected_at), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="capitalize">{formatEnum(row.result)}</TableCell>
                    <TableCell className="text-xs">{row.odometer_miles ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
        <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
          <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Driver credentials</h3>
          <p className="text-sm font-mono text-slate-500 dark:text-slate-400">License class and expiration tracking (one active record per staff member per facility).</p>
        </div>
        <div className="relative z-10 overflow-x-auto p-4">
          {loading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : !facilityReady ? null : drivers.length === 0 ? (
            <p className="text-sm font-mono text-slate-500">No driver credentials yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>License expires</TableHead>
                  <TableHead>Med card</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-emerald-500/5 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer group">
                    <TableCell>
                      {row.staff ? `${row.staff.first_name} ${row.staff.last_name}`.trim() : "—"}
                    </TableCell>
                    <TableCell className="capitalize">{formatEnum(row.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {row.license_expires_on ? format(new Date(row.license_expires_on), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {row.medical_card_expires_on ? format(new Date(row.medical_card_expires_on), "MMM d, yyyy") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
