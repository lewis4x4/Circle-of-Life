"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import { Bus, CalendarDays, CircleDollarSign, MapPin, Clock, Settings2 } from "lucide-react";

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
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";

type FleetRow = Database["public"]["Tables"]["fleet_vehicles"]["Row"];
type InspectionRow = Database["public"]["Tables"]["vehicle_inspection_logs"]["Row"] & {
  fleet_vehicles: { name: string } | null;
};
type DriverRow = Database["public"]["Tables"]["driver_credentials"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

type TransportRequestRow = Database["public"]["Tables"]["resident_transport_requests"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

function formatEnum(s: string) {
  return s.replace(/_/g, " ");
}

function formatAppointmentTime(t: string | null): string {
  if (!t) return "—";
  try {
    return format(parseISO(`2000-01-01T${t.slice(0, 8)}`), "h:mm a");
  } catch {
    return t;
  }
}

/** Group label for an appointment_date (YYYY-MM-DD): Today / Tomorrow / weekday. */
function formatUpcomingDayLabel(dateStr: string): string {
  try {
    const d = parseISO(`${dateStr}T12:00:00.000Z`);
    const today = startOfDay(new Date());
    const target = startOfDay(d);
    if (isSameDay(target, today)) return "Today";
    if (isSameDay(target, addDays(today, 1))) return "Tomorrow";
    return format(d, "EEEE, MMM d");
  } catch {
    return dateStr;
  }
}

/** Calendar days from today for a YYYY-MM-DD (or timestamptz) string; null if missing/invalid. */
function daysUntilCalendar(dateStr: string | null): number | null {
  if (!dateStr) return null;
  try {
    const d = startOfDay(parseISO(dateStr.length <= 10 ? `${dateStr}T12:00:00.000Z` : dateStr));
    return differenceInCalendarDays(d, startOfDay(new Date()));
  } catch {
    return null;
  }
}

const COMPLIANCE_WINDOW_DAYS = 60;

type DriverAlert = {
  key: string;
  title: string;
  staffName: string;
  staffId: string;
  expiresOn: string;
  daysUntil: number;
};

type VehicleAlert = {
  key: string;
  title: string;
  vehicleName: string;
  expiresOn: string;
  daysUntil: number;
};

function formatAlertDeadline(daysUntil: number) {
  if (daysUntil < 0) {
    const n = Math.abs(daysUntil);
    return `Expired ${n}d ago`;
  }
  if (daysUntil === 0) return "Expires today";
  return `In ${daysUntil}d`;
}

export default function AdminTransportationHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [transportRequests, setTransportRequests] = useState<TransportRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFleet([]);
      setInspections([]);
      setDrivers([]);
      setTransportRequests([]);
      setLoading(false);
      return;
    }
    try {
      const today = format(startOfDay(new Date()), "yyyy-MM-dd");
      const [fRes, iRes, dRes, tRes] = await Promise.all([
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
        supabase
          .from("resident_transport_requests")
          .select("id, appointment_date, appointment_time, destination_name, purpose, status, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .gte("appointment_date", today)
          .order("appointment_date", { ascending: true })
          .order("appointment_time", { ascending: true })
          .limit(25),
      ]);
      if (fRes.error) throw fRes.error;
      if (iRes.error) throw iRes.error;
      if (dRes.error) throw dRes.error;
      if (tRes.error) throw tRes.error;
      setFleet(fRes.data ?? []);
      setInspections((iRes.data ?? []) as InspectionRow[]);
      setDrivers((dRes.data ?? []) as DriverRow[]);
      setTransportRequests((tRes.data ?? []) as TransportRequestRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transportation data.");
      setFleet([]);
      setInspections([]);
      setDrivers([]);
      setTransportRequests([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const driverAlerts = useMemo((): DriverAlert[] => {
    const out: DriverAlert[] = [];
    for (const row of drivers) {
      const staffName = row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Unknown staff";
      const lic = daysUntilCalendar(row.license_expires_on);
      if (lic !== null && lic <= COMPLIANCE_WINDOW_DAYS) {
        out.push({
          key: `${row.id}-license`,
          title: "Driver license",
          staffName,
          staffId: row.staff_id,
          expiresOn: row.license_expires_on!,
          daysUntil: lic,
        });
      }
      const med = daysUntilCalendar(row.medical_card_expires_on);
      if (med !== null && med <= COMPLIANCE_WINDOW_DAYS) {
        out.push({
          key: `${row.id}-medical`,
          title: "DOT medical card",
          staffName,
          staffId: row.staff_id,
          expiresOn: row.medical_card_expires_on!,
          daysUntil: med,
        });
      }
    }
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [drivers]);

  const vehicleAlerts = useMemo((): VehicleAlert[] => {
    const out: VehicleAlert[] = [];
    for (const row of fleet) {
      const ins = daysUntilCalendar(row.insurance_expires_on);
      if (ins !== null && ins <= COMPLIANCE_WINDOW_DAYS) {
        out.push({
          key: `${row.id}-ins`,
          title: "Vehicle insurance",
          vehicleName: row.name,
          expiresOn: row.insurance_expires_on!,
          daysUntil: ins,
        });
      }
      const reg = daysUntilCalendar(row.registration_expires_on);
      if (reg !== null && reg <= COMPLIANCE_WINDOW_DAYS) {
        out.push({
          key: `${row.id}-reg`,
          title: "Vehicle registration",
          vehicleName: row.name,
          expiresOn: row.registration_expires_on!,
          daysUntil: reg,
        });
      }
    }
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [fleet]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const upcomingByDay = useMemo(() => {
    const groups: { dateStr: string; rows: TransportRequestRow[] }[] = [];
    for (const row of transportRequests) {
      const d = row.appointment_date;
      if (!d) continue;
      const last = groups[groups.length - 1];
      if (last && last.dateStr === d) {
        last.rows.push(row);
      } else {
        groups.push({ dateStr: d, rows: [row] });
      }
    }
    return groups;
  }, [transportRequests]);

  const hasCriticalAlerts = driverAlerts.some(a => a.daysUntil <= 14) || vehicleAlerts.some(a => a.daysUntil <= 14);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={hasCriticalAlerts} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        
        {/* ─── MOONSHOT HEADER ─── */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
           <div className="space-y-2">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 SYS: Module 15
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Fleet Operations
                {hasCriticalAlerts && <PulseDot colorClass="bg-rose-500" />}
             </h1>
             <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Manage facility transport requests, fleet inspections, and driver compliance all in one view.
             </p>
           </div>
           <div className="flex flex-wrap items-center gap-2">
             <Link
               href="/admin/transportation/mileage-approvals"
               className={cn(
                 buttonVariants({ size: "default", variant: "outline" }),
                 "h-12 gap-2 rounded-full border-slate-300/80 px-5 text-[10px] font-bold uppercase tracking-widest dark:border-white/15 dark:bg-white/5",
               )}
             >
               <CircleDollarSign className="h-4 w-4" aria-hidden />
               Mileage approvals
             </Link>
             <Link
               href="/admin/transportation/calendar"
               className={cn(
                 buttonVariants({ size: "default", variant: "outline" }),
                 "h-12 gap-2 rounded-full border-slate-300/80 px-5 text-[10px] font-bold uppercase tracking-widest dark:border-white/15 dark:bg-white/5",
               )}
             >
               <CalendarDays className="h-4 w-4" aria-hidden />
               Week view
             </Link>
             <Link href="/admin/transportation/requests/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg")} >
               + Transport request
             </Link>
             <Link href="/admin/transportation/vehicles/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold uppercase tracking-widest text-[10px] tap-responsive bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg")} >
               + Vehicle
             </Link>
             <Link
               href="/admin/transportation/settings"
               className={cn(
                 buttonVariants({ size: "default", variant: "outline" }),
                 "h-12 gap-2 rounded-full border-slate-300/80 px-5 text-[10px] font-bold uppercase tracking-widest dark:border-white/15 dark:bg-white/5",
               )}
             >
               <Settings2 className="h-4 w-4" aria-hidden />
               Mileage rate
             </Link>
           </div>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px] lg:col-span-2">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={fleet.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between p-2">
                <h3 className="text-[11px] font-bold tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <Bus className="h-4 w-4" /> Active Fleet Size
                </h3>
                <p className="text-6xl font-display font-medium tracking-tight text-indigo-600 dark:text-indigo-400 pb-1">{fleet.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px] lg:col-span-2">
            <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
              <Sparkline colorClass="text-emerald-500" variant={1} />
              <MonolithicWatermark value={drivers.length} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between p-2">
                <h3 className="text-[11px] font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   Active Drivers
                </h3>
                <p className="text-6xl font-display font-medium tracking-tight text-emerald-600 dark:text-emerald-400 pb-1">{drivers.length}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {facilityReady && (
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 bg-white/60 p-6 md:p-8 shadow-sm backdrop-blur-3xl dark:border-white/5 dark:bg-white/[0.015]">
          <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between px-2 text-slate-800 dark:text-slate-200">
            <div>
              <h3 className="text-[14px] font-bold uppercase tracking-widest flex items-center gap-2">
                <PulseDot colorClass="bg-indigo-500" />
                Upcoming Resident Transport
              </h3>
              <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                Appointments on or after today. Open a row to assign a vehicle, driver, and complete.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/transportation/calendar"
                className={cn(
                  buttonVariants({ size: "default", variant: "outline" }),
                  "shrink-0 h-12 gap-2 rounded-full px-5 text-[10px] font-bold uppercase tracking-widest dark:border-white/10 bg-white dark:bg-white/5 shadow-sm",
                )}
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
                Week view
              </Link>
              <Link
                href="/admin/transportation/requests/new"
                className={cn(buttonVariants({ size: "default", variant: "outline" }), "shrink-0 h-12 rounded-full px-6 text-[10px] font-bold uppercase tracking-widest dark:border-white/10 bg-white dark:bg-white/5 shadow-sm")}
              >
                Log Request
              </Link>
            </div>
          </div>
          {loading ? (
            <p className="text-sm font-mono text-slate-500 py-10 pl-2">Loading trips…</p>
          ) : transportRequests.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 mx-2">
               <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No scheduled trips</p>
              <p className="text-sm opacity-80 mt-1">No upcoming transport requests on file.</p>
            </div>
          ) : (
            <div className="space-y-12">
              {upcomingByDay.map((group) => (
                <div key={group.dateStr}>
                  <p className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 pl-2">
                    {formatUpcomingDayLabel(group.dateStr)}
                    <span className="ml-2 font-normal text-slate-400">
                      — {group.rows.length} Trip{group.rows.length === 1 ? "" : "s"}
                    </span>
                  </p>
                  <MotionList className="space-y-3">
                    {group.rows.map((row) => {
                      const name = row.residents
                        ? `${row.residents.first_name} ${row.residents.last_name}`
                        : "Resident";
                      const apptDate = parseISO(`${row.appointment_date}T12:00:00.000Z`);
                      return (
                        <MotionItem
                          key={row.id}
                          className="rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transform-gpu transition-colors hover:border-indigo-300 dark:hover:border-indigo-500/40 group overflow-hidden"
                        >
                          <Link
                            href={`/admin/transportation/requests/${row.id}`}
                            className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between w-full h-full outline-none"
                          >
                            <div className="min-w-0 flex items-center gap-4">
                              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                                 <Bus className="w-5 h-5 text-indigo-500" />
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{name}</p>
                                <p className="truncate text-sm font-medium text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-2">
                                  <MapPin className="w-3.5 h-3.5 opacity-50" />
                                  {row.destination_name}
                                  {row.purpose ? <><span className="opacity-30">•</span>{row.purpose}</> : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-4">
                              <div className="flex flex-col items-end">
                                <span className="font-bold uppercase tracking-widest text-[10px] text-slate-400 mb-1">Time</span>
                                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 flex items-center gap-1.5 border border-indigo-100 dark:border-indigo-500/20">
                                  <Clock className="w-3 h-3" />
                                  {format(apptDate, "EEE MMM d")} · {formatAppointmentTime(row.appointment_time)}
                                </span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="font-bold uppercase tracking-widest text-[10px] text-slate-400 mb-1">Status</span>
                                <span className={cn(
                                  "rounded-full px-4 py-1 text-xs font-bold uppercase tracking-widest border",
                                  row.status === "scheduled" ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" :
                                  row.status === "completed" ? "bg-slate-100 border-slate-200 text-slate-600 dark:bg-white/5 dark:text-slate-400 dark:border-white/10" :
                                  "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                                )}>
                                  {formatEnum(row.status)}
                                </span>
                              </div>
                            </div>
                          </Link>
                        </MotionItem>
                      );
                    })}
                  </MotionList>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!facilityReady && (
        <p className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 shadow-sm font-medium">
          Select a facility to load fleet and driver records.
        </p>
      )}

      {error && (
        <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium">
          {error}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* ACTION QUEUE: Credential & Insurance Expiries */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4 pl-2">
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                Compliance Blockers
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500 pl-2">Loading…</p>
              ) : driverAlerts.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-[2rem] border border-dashed border-white/20 dark:border-white/5 backdrop-blur-md">
                  <p className="font-semibold text-lg">
                    {drivers.length === 0 && fleet.length === 0 ? "Inbox Zero" : "No Driver Alerts"}
                  </p>
                  <p className="text-sm opacity-80 mt-1">
                    {drivers.length === 0 && fleet.length === 0
                      ? "Add fleet vehicles and driver credentials to track compliance."
                      : `No license or medical card expiring within ${COMPLIANCE_WINDOW_DAYS} days.`}
                  </p>
                </div>
              ) : (
                driverAlerts.map((a) => {
                  const critical = a.daysUntil < 0 || a.daysUntil <= 14;
                  return (
                    <MotionItem
                      key={a.key}
                      className={cn(
                        "p-6 rounded-[2rem] border shadow-sm backdrop-blur-xl relative overflow-hidden group transition-colors",
                        critical
                          ? "border-red-200 dark:border-red-900/40 bg-white/60 dark:bg-slate-900/60 hover:border-red-300 dark:hover:border-red-800/60"
                          : "border-amber-200 dark:border-amber-900/40 bg-white/60 dark:bg-slate-900/60 hover:border-amber-300 dark:hover:border-amber-800/60",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-0 left-0 w-1.5 h-full",
                          critical ? "bg-red-500" : "bg-amber-500",
                        )}
                      />
                      <div className="flex justify-between items-start mb-4 pl-1">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border",
                            critical
                              ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20"
                              : "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
                          )}
                        >
                          {a.daysUntil < 0 ? "Expired" : a.daysUntil <= 14 ? "Action needed" : "Upcoming"}
                        </span>
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">
                          {formatAlertDeadline(a.daysUntil)}
                        </span>
                      </div>
                      <div className="mb-5 pl-1">
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight leading-tight mb-2">
                          {a.title} &mdash; {a.staffName}
                        </p>
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                          On file until {format(parseISO(a.expiresOn.length <= 10 ? `${a.expiresOn}T12:00:00.000Z` : a.expiresOn), "MMM d, yyyy")}.
                        </p>
                      </div>
                      <div className="flex justify-start pl-1 mt-2">
                        <Link
                          href={`/admin/staff/${a.staffId}`}
                          className={cn(
                            buttonVariants({ variant: "default", size: "sm" }),
                            "h-10 rounded-full px-6 font-bold uppercase tracking-widest text-[10px]",
                            critical ? "bg-red-600 hover:bg-red-700 text-white shadow-md" : "bg-amber-500 hover:bg-amber-600 text-white shadow-md",
                          )}
                        >
                          Open Staff Record
                        </Link>
                      </div>
                    </MotionItem>
                  );
                })
              )}
            </MotionList>
            
          </div>

          {/* WATCHLIST: Fleet Inspections */}
          <div className="space-y-4 lg:pl-6 lg:border-l border-transparent dark:border-transparent pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4 pl-2">
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                Fleet Readiness
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500 pl-2">Loading…</p>
              ) : vehicleAlerts.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-[2rem] border border-dashed border-white/20 dark:border-white/5 backdrop-blur-md">
                  <p className="font-semibold text-lg">
                    {fleet.length === 0 ? "No Fleet Units" : "No Vehicle Alerts"}
                  </p>
                  <p className="text-sm opacity-80 mt-1">
                    {fleet.length === 0
                      ? "Register a vehicle to track insurance and registration expirations."
                      : `No insurance or registration expiring within ${COMPLIANCE_WINDOW_DAYS} days.`}
                  </p>
                </div>
              ) : (
                vehicleAlerts.map((a) => {
                  const critical = a.daysUntil < 0 || a.daysUntil <= 14;
                  return (
                    <MotionItem
                      key={a.key}
                      className={cn(
                        "p-6 rounded-[2rem] border shadow-sm backdrop-blur-xl relative overflow-hidden group transition-colors",
                        critical
                          ? "border-red-200 dark:border-red-900/40 bg-white/60 dark:bg-slate-900/60 hover:border-red-300 dark:hover:border-red-800/60"
                          : "border-amber-200 dark:border-amber-900/40 bg-white/60 dark:bg-slate-900/60 hover:border-amber-300 dark:hover:border-amber-800/60",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-0 left-0 w-1.5 h-full",
                          critical ? "bg-red-500" : "bg-amber-500",
                        )}
                      />
                      <div className="flex justify-between items-start mb-4 pl-1">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border",
                            critical
                              ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20"
                              : "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
                          )}
                        >
                          {a.title}
                        </span>
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">
                          {formatAlertDeadline(a.daysUntil)}
                        </span>
                      </div>
                      <div className="mb-5 pl-1">
                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight leading-tight mb-2">
                          {a.vehicleName}
                        </p>
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                          Renewal date {format(parseISO(a.expiresOn.length <= 10 ? `${a.expiresOn}T12:00:00.000Z` : a.expiresOn), "MMM d, yyyy")}.
                        </p>
                      </div>
                      <div className="flex justify-start pl-1 mt-2">
                        <Link
                          href="/admin/transportation/inspections/new"
                          className={cn(
                            buttonVariants({ variant: "default", size: "sm" }),
                            "h-10 rounded-full px-6 font-bold uppercase tracking-widest text-[10px]",
                            critical ? "bg-white text-red-600 hover:bg-slate-100 shadow-md border border-red-200 dark:border-red-500/30 dark:bg-white/5 dark:text-red-400 dark:hover:bg-red-500/20" : "bg-white text-amber-600 hover:bg-slate-100 shadow-md border border-amber-200 dark:border-amber-500/30 dark:bg-white/5 dark:text-amber-400 dark:hover:bg-amber-500/20",
                          )}
                        >
                          Log Inspection / Follow-up
                        </Link>
                      </div>
                    </MotionItem>
                  );
                })
              )}

              {/* Real historical inspections */}
              <div className="glass-panel mt-10 p-6 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.015]">
                 <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 mb-4 ml-2">Recent Logs</h4>
                 <MotionList className="space-y-3">
                   {inspections.slice(0, 3).map(row => (
                     <MotionItem key={row.id} className="p-4 rounded-[1.5rem] border border-slate-200/60 dark:border-white/5 bg-white dark:bg-white/[0.03] flex gap-4 items-center shadow-sm">
                       <div className="flex-1 min-w-0">
                         <p className="text-sm font-semibold text-slate-900 dark:text-slate-300 tracking-tight truncate">
                           {row.fleet_vehicles?.name ?? "Unknown"}
                         </p>
                         <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate capitalize mt-1">
                           Result: {formatEnum(row.result)}
                         </p>
                       </div>
                       <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 text-right bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 px-3 py-1.5 rounded-full shrink-0">
                         {format(new Date(row.inspected_at), "MMM d")}
                       </span>
                     </MotionItem>
                   ))}
                   {inspections.length === 0 && !loading && (
                     <p className="text-sm text-slate-500 dark:text-zinc-500 font-medium px-2 py-4">No historical inspections have been logged.</p>
                   )}
                 </MotionList>
              </div>
            </MotionList>
            
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
