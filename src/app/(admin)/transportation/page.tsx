"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import { Bus, CalendarDays, CircleDollarSign, Download, MapPin, Clock, Settings2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { fetchTransportationHubSnapshot } from "@/lib/transportation/load-transportation-hub";
import {
  formatTransportationAppointmentTime,
  formatTransportationDriverStaffLabel,
} from "@/lib/transportation/transportation-display-copy";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type TransportRequestRow = Database["public"]["Tables"]["resident_transport_requests"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

type TransportRequestExportRow = Database["public"]["Tables"]["resident_transport_requests"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

type TransportRequestStatus = Database["public"]["Enums"]["transport_request_status"];

const TRANSPORT_STATUS_FILTERS: { value: "all" | TransportRequestStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "requested", label: "Requested" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function buildTransportRequestsCsv(rows: TransportRequestExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "resident_id",
    "resident_first_name",
    "resident_last_name",
    "appointment_date",
    "appointment_time",
    "destination_name",
    "destination_address",
    "purpose",
    "status",
    "transport_type",
    "requested_by",
    "pickup_time",
    "return_time",
    "escort_required",
    "wheelchair_required",
    "driver_staff_id",
    "escort_staff_id",
    "vehicle_id",
    "notes",
    "cancellation_reason",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.resident_id),
      csvEscapeCell(row.residents?.first_name ?? ""),
      csvEscapeCell(row.residents?.last_name ?? ""),
      csvEscapeCell(row.appointment_date),
      csvEscapeCell(row.appointment_time ?? ""),
      csvEscapeCell(row.destination_name),
      csvEscapeCell(row.destination_address ?? ""),
      csvEscapeCell(row.purpose),
      csvEscapeCell(row.status),
      csvEscapeCell(row.transport_type),
      csvEscapeCell(row.requested_by),
      csvEscapeCell(row.pickup_time ?? ""),
      csvEscapeCell(row.return_time ?? ""),
      csvEscapeCell(String(row.escort_required)),
      csvEscapeCell(String(row.wheelchair_required)),
      csvEscapeCell(row.driver_staff_id ?? ""),
      csvEscapeCell(row.escort_staff_id ?? ""),
      csvEscapeCell(row.vehicle_id ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.cancellation_reason ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

function formatEnum(s: string) {
  return s.replace(/_/g, " ");
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
  const facilityReady =
    selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId);

  const {
    data,
    isPending,
    error: queryError,
  } = useQuery({
    queryKey: ["transportation", "hub", selectedFacilityId],
    enabled: facilityReady,
    queryFn: () => fetchTransportationHubSnapshot(selectedFacilityId!),
  });

  const fleet = useMemo(() => data?.fleet ?? [], [data]);
  const inspections = useMemo(() => data?.inspections ?? [], [data]);
  const drivers = useMemo(() => data?.drivers ?? [], [data]);
  const transportRequests = useMemo(() => data?.transportRequests ?? [], [data]);
  const loading = facilityReady && isPending && !data;
  const [error, setError] = useState<string | null>(null);
  const loadError =
    queryError instanceof Error
      ? queryError.message
      : queryError
        ? "Failed to load transportation data."
        : null;
  const displayError = error ?? loadError;

  const [exportingCsv, setExportingCsv] = useState(false);
  const [transportStatusFilter, setTransportStatusFilter] = useState<
    "all" | TransportRequestStatus
  >("all");

  const exportTransportRequestsCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("resident_transport_requests")
        .select("*, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null);
      if (transportStatusFilter !== "all") {
        q = q.eq("status", transportStatusFilter);
      }
      const { data, error: qErr } = await q
        .order("updated_at", { ascending: false })
        .limit(500);
      if (qErr) throw qErr;
      const rows = (data ?? []) as TransportRequestExportRow[];
      const csv = buildTransportRequestsCsv(rows);
      const stamp = format(new Date(), "yyyy-MM-dd");
      const scope =
        transportStatusFilter === "all" ? "" : `_${transportStatusFilter}`;
      triggerCsvDownload(`resident-transport-requests-${stamp}${scope}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export transport requests.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId, transportStatusFilter]);

  const driverAlerts = useMemo((): DriverAlert[] => {
    const out: DriverAlert[] = [];
    for (const row of drivers) {
      const staffName = formatTransportationDriverStaffLabel(row.staff);
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

  const filteredTransportRequests = useMemo(() => {
    if (transportStatusFilter === "all") return transportRequests;
    return transportRequests.filter((r) => r.status === transportStatusFilter);
  }, [transportRequests, transportStatusFilter]);

  const upcomingByDay = useMemo(() => {
    const groups: { dateStr: string; rows: TransportRequestRow[] }[] = [];
    for (const row of filteredTransportRequests) {
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
  }, [filteredTransportRequests]);

  const hasCriticalAlerts = driverAlerts.some(a => a.daysUntil <= 14) || vehicleAlerts.some(a => a.daysUntil <= 14);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      
      <div className="relative z-10 space-y-6">
        
        {/* ─── MOONSHOT HEADER ─── */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
           <div className="space-y-2">
             
             <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Fleet Operations
                {hasCriticalAlerts && <></>}
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
                 "h-12 gap-2 rounded-full border-slate-300/80 px-5 text-[10px] font-bold dark:border-white/15 dark:bg-white/5",
               )}
             >
               <CircleDollarSign className="h-4 w-4" aria-hidden />
               Mileage approvals
             </Link>
             <Link
               href="/admin/transportation/calendar"
               className={cn(
                 buttonVariants({ size: "default", variant: "outline" }),
                 "h-12 gap-2 rounded-full border-slate-300/80 px-5 text-[10px] font-bold dark:border-white/15 dark:bg-white/5",
               )}
             >
               <CalendarDays className="h-4 w-4" aria-hidden />
               Week view
             </Link>
             <Link href="/admin/transportation/requests/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold text-[10px] tap-responsive bg-primary-600 hover:bg-primary-700 text-white shadow-lg")} >
               + Transport request
             </Link>
             <Link href="/admin/transportation/vehicles/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold text-[10px] tap-responsive bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg")} >
               + Vehicle
             </Link>
             <Link
               href="/admin/transportation/settings"
               className={cn(
                 buttonVariants({ size: "default", variant: "outline" }),
                 "h-12 gap-2 rounded-full border-slate-300/80 px-5 text-[10px] font-bold dark:border-white/15 dark:bg-white/5",
               )}
             >
               <Settings2 className="h-4 w-4" aria-hidden />
               Mileage rate
             </Link>
           </div>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px] lg:col-span-2">
            <V2Card hoverColor="indigo" className="border-primary-500/20 dark:border-primary-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
              <></>
              <MonolithicWatermark value={fleet.length} className="text-primary-600/5 dark:text-primary-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between p-2">
                <h3 className="text-[11px] font-bold tracking-wider uppercase text-primary-600 dark:text-primary-400 flex items-center gap-2">
                  <Bus className="h-4 w-4" /> Active Fleet Size
                </h3>
                <p className="text-2xl font-medium tracking-tight text-primary-600 dark:text-primary-400 pb-1">{fleet.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px] lg:col-span-2">
            <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
              <></>
              <MonolithicWatermark value={drivers.length} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between p-2">
                <h3 className="text-[11px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   Active Drivers
                </h3>
                <p className="text-2xl font-medium tracking-tight text-emerald-600 dark:text-emerald-400 pb-1">{drivers.length}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {facilityReady && (
        <div className="rounded-lg border border-slate-200/60 bg-card p-6 md:p-8 shadow-sm dark:border-white/5 dark:bg-white/[0.015]">
          <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between px-2 text-slate-800 dark:text-slate-200">
            <div>
              <h3 className="text-[14px] font-bold uppercase tracking-wider flex items-center gap-2">
                <></>
                Upcoming Resident Transport
              </h3>
              <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                Appointments on or after today. Open a row to assign a vehicle, driver, and complete.
                {transportRequests.length > 0 && (
                  <span className="block mt-1 text-xs">
                    Showing {filteredTransportRequests.length} of {transportRequests.length} loaded trip
                    {transportRequests.length === 1 ? "" : "s"}
                    {transportStatusFilter !== "all" ? ` (${formatEnum(transportStatusFilter)})` : ""}.
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="whitespace-nowrap font-bold uppercase tracking-wider">Status</span>
                <select
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-100"
                  value={transportStatusFilter}
                  onChange={(e) =>
                    setTransportStatusFilter(e.target.value as "all" | TransportRequestStatus)
                  }
                  aria-label="Filter upcoming trips by status"
                >
                  {TRANSPORT_STATUS_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!facilityReady || exportingCsv}
                className="shrink-0 h-12 gap-2 rounded-full px-5 text-[10px] font-bold dark:border-white/10 bg-white dark:bg-white/5 shadow-sm"
                onClick={() => void exportTransportRequestsCsv()}
              >
                <Download className="h-4 w-4" aria-hidden />
                {exportingCsv ? "Preparing…" : "Download transport CSV"}
              </Button>
              <Link
                href="/admin/transportation/calendar"
                className={cn(
                  buttonVariants({ size: "default", variant: "outline" }),
                  "shrink-0 h-12 gap-2 rounded-full px-5 text-[10px] font-bold dark:border-white/10 bg-white dark:bg-white/5 shadow-sm",
                )}
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
                Week view
              </Link>
              <Link
                href="/admin/transportation/requests/new"
                className={cn(buttonVariants({ size: "default", variant: "outline" }), "shrink-0 h-12 rounded-full px-6 text-[10px] font-bold dark:border-white/10 bg-white dark:bg-white/5 shadow-sm")}
              >
                Log Request
              </Link>
            </div>
          </div>
          {loading ? (
            <p className="text-sm font-mono text-slate-500 py-10 pl-2">Loading trips…</p>
          ) : transportRequests.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 rounded-lg border border-dashed border-slate-200 dark:border-white/10 mx-2">
               <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No scheduled trips</p>
              <p className="text-sm opacity-80 mt-1">No upcoming transport requests on file.</p>
            </div>
          ) : filteredTransportRequests.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 rounded-lg border border-dashed border-slate-200 dark:border-white/10 mx-2">
              <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No trips match this status</p>
              <p className="text-sm opacity-80 mt-1">Try &quot;All statuses&quot; or another filter.</p>
            </div>
          ) : (
            <div className="space-y-12">
              {upcomingByDay.map((group) => (
                <div key={group.dateStr}>
                  <p className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 pl-2">
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
                          className="rounded-lg border border-slate-200/90 bg-white dark:border-white/5 shadow-sm transform-gpu transition-colors hover:border-primary-300 dark:hover:border-primary-500/40 group overflow-hidden"
                        >
                          <Link
                            href={`/admin/transportation/requests/${row.id}`}
                            className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between w-full h-full outline-none"
                          >
                            <div className="min-w-0 flex items-center gap-4">
                              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                                 <Bus className="w-5 h-5 text-primary-500" />
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
                                <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 mb-1">Time</span>
                                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary-700 dark:bg-primary-500/10 dark:text-primary-400 flex items-center gap-1.5 border border-primary-100 dark:border-primary-500/20">
                                  <Clock className="w-3 h-3" />
                                  {format(apptDate, "EEE MMM d")} · {formatTransportationAppointmentTime(row.appointment_time)}
                                </span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 mb-1">Status</span>
                                <span className={cn(
                                  "rounded-full px-4 py-1 text-xs font-bold uppercase tracking-wider border",
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
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 shadow-sm font-medium">
          Select a facility to load fleet and driver records.
        </p>
      )}

      {displayError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium">
          {displayError}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* ACTION QUEUE: Credential & Insurance Expiries */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4 pl-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Compliance Blockers
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500 pl-2">Loading…</p>
              ) : driverAlerts.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/30 rounded-lg border border-dashed border-white/20 dark:border-white/5 ">
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
                        "p-6 rounded-lg border shadow-sm relative overflow-hidden group transition-colors",
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
                            "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border",
                            critical
                              ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20"
                              : "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
                          )}
                        >
                          {a.daysUntil < 0 ? "Expired" : a.daysUntil <= 14 ? "Action needed" : "Upcoming"}
                        </span>
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
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
                            "h-10 rounded-full px-6 font-bold text-[10px]",
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
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Fleet Readiness
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500 pl-2">Loading…</p>
              ) : vehicleAlerts.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/30 rounded-lg border border-dashed border-white/20 dark:border-white/5 ">
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
                        "p-6 rounded-lg border shadow-sm relative overflow-hidden group transition-colors",
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
                            "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border",
                            critical
                              ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20"
                              : "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
                          )}
                        >
                          {a.title}
                        </span>
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
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
                            "h-10 rounded-full px-6 font-bold text-[10px]",
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
              <div className="mt-10 p-6 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.015]">
                 <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-4 ml-2">Recent Logs</h4>
                 <MotionList className="space-y-3">
                   {inspections.slice(0, 3).map(row => (
                     <MotionItem key={row.id} className="p-4 rounded-lg border border-slate-200/60 dark:border-white/5 bg-white flex gap-4 items-center shadow-sm">
                       <div className="flex-1 min-w-0">
                         <p className="text-sm font-semibold text-slate-900 dark:text-slate-300 tracking-tight truncate">
                           {row.fleet_vehicles?.name ?? "Unknown"}
                         </p>
                         <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate capitalize mt-1">
                           Result: {formatEnum(row.result)}
                         </p>
                       </div>
                       <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400 text-right bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 px-3 py-1.5 rounded-full shrink-0">
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
