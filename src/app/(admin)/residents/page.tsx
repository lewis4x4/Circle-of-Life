"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/demo-mode";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type Acuity = 1 | 2 | 3;
type AdlStatus = "independent" | "assisted" | "dependent";
type ResidencyStatus = "active" | "hospital" | "loa";

type ResidentRow = {
  id: string;
  name: string;
  initials: string;
  room: string;
  unit: string;
  acuity: Acuity;
  adlStatus: AdlStatus;
  status: ResidencyStatus;
  careSummary: string;
  updatedAt: string;
};

type SupabaseResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string | null;
  status: string | null;
  acuity_level: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

type SupabaseBedRow = {
  id: string;
  room_id: string | null;
  bed_label: string | null;
  current_resident_id: string | null;
};

type SupabaseRoomRow = {
  id: string;
  room_number: string | null;
  unit_id: string | null;
};

type SupabaseUnitRow = {
  id: string;
  name: string | null;
};

type QueryError = {
  message: string;
};

type QueryResult<T> = {
  data: T[] | null;
  error: QueryError | null;
};

const DEFAULT_FILTERS = {
  search: "",
  acuity: "all",
  unit: "all",
  adl: "all",
  status: "all",
};

export default function AdminResidentsPage() {
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ResidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoFallbackActive, setDemoFallbackActive] = useState(false);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [acuity, setAcuity] = useState(DEFAULT_FILTERS.acuity);
  const [unit, setUnit] = useState(DEFAULT_FILTERS.unit);
  const [adl, setAdl] = useState(DEFAULT_FILTERS.adl);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);

  const loadResidents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const liveRows = await fetchResidentsFromSupabase(selectedFacilityId);
      if (liveRows.length > 0) {
        setDemoFallbackActive(false);
        setRows(liveRows);
      } else if (isDemoMode()) {
        // DEMO HYDRATION: sample roster when DB is unseeded (NEXT_PUBLIC_DEMO_MODE=true only)
        setDemoFallbackActive(true);
        setRows([
          { id: "m1", name: "Margaret Sullivan", initials: "MS", room: "101-A", unit: "East Wing", acuity: 2, adlStatus: "assisted", status: "active", careSummary: "Routine assisted ADL support", updatedAt: "Oct 12, 09:42 AM" },
          { id: "m2", name: "Arthur Pendelton", initials: "AP", room: "102-B", unit: "East Wing", acuity: 1, adlStatus: "independent", status: "active", careSummary: "Independent daily routine", updatedAt: "Oct 12, 08:30 AM" },
          { id: "m3", name: "Eleanor Vance", initials: "EV", room: "104-A", unit: "Enhanced ALF Services", acuity: 3, adlStatus: "dependent", status: "hospital", careSummary: "Hospital hold - return coordination in progress", updatedAt: "Oct 11, 11:15 PM" },
          { id: "m4", name: "Robert Chen", initials: "RC", room: "201-A", unit: "West Wing", acuity: 1, adlStatus: "independent", status: "active", careSummary: "Independent daily routine", updatedAt: "Oct 10, 04:20 PM" },
          { id: "m5", name: "Lucille Booth", initials: "LB", room: "205-B", unit: "West Wing", acuity: 2, adlStatus: "assisted", status: "active", careSummary: "Routine assisted ADL support", updatedAt: "Oct 12, 07:10 AM" },
        ]);
      } else {
        setDemoFallbackActive(false);
        setRows([]);
      }
    } catch (err) {
      setDemoFallbackActive(false);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    const requestedSearch = searchParams.get("search") ?? DEFAULT_FILTERS.search;
    const requestedAcuity = searchParams.get("acuity") ?? DEFAULT_FILTERS.acuity;
    const requestedUnit = searchParams.get("unit") ?? DEFAULT_FILTERS.unit;
    const requestedAdl = searchParams.get("adl") ?? DEFAULT_FILTERS.adl;
    const requestedStatus = searchParams.get("status") ?? DEFAULT_FILTERS.status;

    setSearch(requestedSearch);
    setAcuity(["all", "1", "2", "3", "watchlist"].includes(requestedAcuity) ? requestedAcuity : DEFAULT_FILTERS.acuity);
    setUnit(requestedUnit || DEFAULT_FILTERS.unit);
    setAdl(
      ["all", "independent", "assisted", "dependent"].includes(requestedAdl)
        ? requestedAdl
        : DEFAULT_FILTERS.adl,
    );
    setStatus(
      ["all", "active", "hospital", "loa", "away"].includes(requestedStatus)
        ? requestedStatus
        : DEFAULT_FILTERS.status,
    );
  }, [searchParams]);

  const unitOptions = useMemo(() => {
    const distinctUnits = Array.from(new Set(rows.map((row) => row.unit))).sort((a, b) =>
      a.localeCompare(b),
    );

    return [{ value: "all", label: "All Units" }, ...distinctUnits.map((name) => ({ value: name, label: name }))];
  }, [rows]);

  const filteredRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.name.toLowerCase().includes(loweredSearch) ||
        row.room.toLowerCase().includes(loweredSearch) ||
        row.careSummary.toLowerCase().includes(loweredSearch);
      const matchesAcuity =
        acuity === "all" || (acuity === "watchlist" ? row.acuity === 2 || row.acuity === 3 : String(row.acuity) === acuity);
      const matchesUnit = unit === "all" || row.unit === unit;
      const matchesAdl = adl === "all" || row.adlStatus === adl;
      const matchesStatus =
        status === "all" ||
        (status === "away" ? row.status === "hospital" || row.status === "loa" : row.status === status);

      return matchesSearch && matchesAcuity && matchesUnit && matchesAdl && matchesStatus;
    });
  }, [rows, search, acuity, unit, adl, status]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No residents in this scope",
          description:
            "Live census returned no active residents for the selected facility. Use Add resident or choose a different facility.",
        },
        whenFiltersExcludeAll: {
          title: "No residents match the current filters",
          description:
            "Try broadening acuity, unit, or ADL criteria. Live census data is scoped by your current facility selection.",
        },
      }),
    [rows.length],
  );

  const activeCount = rows.filter((row) => row.status === "active").length;
  const highAcuityCount = rows.filter((row) => row.acuity === 3).length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={highAcuityCount > 0} />
      
      <div className="relative z-10 space-y-6">
        
        {/* ─── MOONSHOT HEADER ─── */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
           <div className="space-y-2">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 SYS: Module 08
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Resident Hub
                {highAcuityCount > 0 && <PulseDot colorClass="bg-rose-500" />}
             </h1>
             <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
               Unified census view with acuity & ADL scope.
             </p>
           </div>
           <div>
              <Link href="/admin/residents/new" className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg")} >
                + Initialize Intake
              </Link>
           </div>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px] lg:col-span-2">
            <V2Card hoverColor="emerald">
              <Sparkline colorClass="text-emerald-500" variant={1} />
              <MonolithicWatermark value={activeCount} className="text-emerald-900/5 dark:text-emerald-100/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2 font-bold">
                  <Users className="h-4 w-4" /> Total Census
                </h3>
                <p className="text-6xl font-display font-medium tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 pb-1">{activeCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px] lg:col-span-2">
            <V2Card hoverColor="rose" className="border-rose-500/20 dark:border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]">
              <Sparkline colorClass="text-rose-500" variant={4} />
              <MonolithicWatermark value={highAcuityCount} className="text-rose-600/5 dark:text-rose-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2 font-bold">
                  High Acuity Profile
                </h3>
                <p className="text-6xl font-display font-medium tracking-tight text-rose-600 dark:text-rose-400 pb-1">{highAcuityCount}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search resident, room, or care note..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "acuity",
            value: acuity,
            onChange: setAcuity,
            options: [
              { value: "all", label: "All Acuity" },
              { value: "watchlist", label: "Watchlist (2-3)" },
              { value: "1", label: "Acuity 1" },
              { value: "2", label: "Acuity 2" },
              { value: "3", label: "Acuity 3" },
            ],
          },
          {
            id: "unit",
            value: unit,
            onChange: setUnit,
            options: unitOptions,
          },
          {
            id: "adl",
            value: adl,
            onChange: setAdl,
            options: [
              { value: "all", label: "All ADL Status" },
              { value: "independent", label: "Independent" },
              { value: "assisted", label: "Assisted" },
              { value: "dependent", label: "Dependent" },
            ],
          },
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All Residency Status" },
              { value: "active", label: "Active" },
              { value: "hospital", label: "Hospital" },
              { value: "loa", label: "LOA" },
              { value: "away", label: "Hospital / LOA" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setAcuity(DEFAULT_FILTERS.acuity);
          setUnit(DEFAULT_FILTERS.unit);
          setAdl(DEFAULT_FILTERS.adl);
          setStatus(DEFAULT_FILTERS.status);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadResidents()} />
      ) : null}
      {!isLoading && !error && demoFallbackActive ? (
        <AdminLiveDataFallbackNotice
          message="Demo mode is active on this resident roster. These rows are illustrative sample residents because no live resident records were returned for the current scope."
          onRetry={() => void loadResidents()}
        />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && filteredRows.length > 0 ? (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />

           <div className="hidden lg:grid grid-cols-[3fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Resident</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Location</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Acuity</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">ADL Status</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Current Status</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
           </div>

           <div className="space-y-4 mt-6 relative z-10">
             <MotionList className="space-y-4">
             {filteredRows.map((resident) => (
                <MotionItem key={resident.id}>
                  <Link
                    href={`/admin/residents/${resident.id}`}
                    className="grid grid-cols-1 lg:grid-cols-[3fr_1fr_1fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full cursor-pointer outline-none"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 flex flex-col items-center justify-center shrink-0">
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold text-sm">{resident.initials}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-xl font-display text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors tracking-tight">{resident.name}</span>
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400 max-w-[250px] truncate">{resident.careSummary}</span>
                      </div>
                    </div>

                    <div className="flex flex-row justify-between lg:justify-start items-center">
                      <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Location</span>
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-200">{resident.room}</span>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{resident.unit}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-row justify-between lg:justify-start items-center">
                      <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Acuity</span>
                      <AcuityBadge acuity={resident.acuity} />
                    </div>

                    <div className="flex flex-row justify-between lg:justify-start items-center">
                      <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">ADL Status</span>
                      <AdlBadge status={resident.adlStatus} />
                    </div>

                    <div className="flex flex-row justify-between lg:justify-start items-center">
                      <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Current Status</span>
                      <ResidentStatusBadge status={resident.status} />
                    </div>

                    <div className="flex flex-row justify-between lg:justify-end items-center">
                      <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Updated</span>
                      <span className="text-[11px] font-mono tracking-widest text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                        {resident.updatedAt}
                      </span>
                    </div>
                  </Link>
                </MotionItem>
             ))}
             </MotionList>
           </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}

async function fetchResidentsFromSupabase(selectedFacilityId: string | null): Promise<ResidentRow[]> {
  const supabase = createClient();
  let residentsQuery = supabase
    .from("residents" as never)
    .select("id, first_name, last_name, facility_id, status, acuity_level, updated_at, deleted_at")
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .limit(300);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsQuery = residentsQuery.eq("facility_id", selectedFacilityId);
  }

  const residentsResult = (await residentsQuery) as unknown as QueryResult<SupabaseResidentRow>;
  const residents = residentsResult.data ?? [];
  const residentsError = residentsResult.error;
  if (residentsError) {
    throw residentsError;
  }

  if (residents.length === 0) {
    return [];
  }

  const residentIds = residents.map((resident) => resident.id);
  const bedsResult = (await supabase
    .from("beds" as never)
    .select("id, room_id, bed_label, current_resident_id")
    .in("current_resident_id", residentIds)) as unknown as QueryResult<SupabaseBedRow>;
  const beds = bedsResult.data ?? [];
  const bedsError = bedsResult.error;
  if (bedsError) {
    throw bedsError;
  }

  const roomIds = Array.from(
    new Set(
      beds
        .map((bed) => bed.room_id)
        .filter((roomId): roomId is string => Boolean(roomId)),
    ),
  );
  const roomsResult = roomIds.length
    ? ((await supabase.from("rooms" as never).select("id, room_number, unit_id").in("id", roomIds)) as unknown as QueryResult<SupabaseRoomRow>)
    : ({ data: [], error: null } as QueryResult<SupabaseRoomRow>);
  const rooms = roomsResult.data ?? [];
  const roomsError = roomsResult.error;
  if (roomsError) {
    throw roomsError;
  }

  const unitIds = Array.from(
    new Set(
      rooms
        .map((room) => room.unit_id)
        .filter((unitId): unitId is string => Boolean(unitId)),
    ),
  );
  const unitsResult = unitIds.length
    ? ((await supabase.from("units" as never).select("id, name").in("id", unitIds)) as unknown as QueryResult<SupabaseUnitRow>)
    : ({ data: [], error: null } as QueryResult<SupabaseUnitRow>);
  const units = unitsResult.data ?? [];
  const unitsError = unitsResult.error;
  if (unitsError) {
    throw unitsError;
  }

  const bedByResident = new Map(
    beds
      .filter((bed): bed is SupabaseBedRow & { current_resident_id: string } => Boolean(bed.current_resident_id))
      .map((bed) => [bed.current_resident_id, bed] as const),
  );
  const roomById = new Map(rooms.map((room) => [room.id, room] as const));
  const unitById = new Map(units.map((unit) => [unit.id, unit] as const));

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown Resident";
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";

    const bed = bedByResident.get(resident.id);
    const room = bed?.room_id ? roomById.get(bed.room_id) : null;
    const unit = room?.unit_id ? unitById.get(room.unit_id) : null;

    const acuity = mapAcuity(resident.acuity_level);
    const status = mapResidencyStatus(resident.status);

    return {
      id: resident.id,
      name: fullName,
      initials,
      room: room?.room_number ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}` : "Unassigned",
      unit: unit?.name ?? "Unassigned",
      acuity,
      adlStatus: mapAdlStatusFromAcuity(acuity),
      status,
      careSummary: buildCareSummary(status, acuity),
      updatedAt: formatUpdatedAt(resident.updated_at),
    } satisfies ResidentRow;
  });
}

function mapAcuity(value: string | null): Acuity {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}

function mapResidencyStatus(value: string | null): ResidencyStatus {
  if (value === "hospital_hold") return "hospital";
  if (value === "loa") return "loa";
  return "active";
}

function mapAdlStatusFromAcuity(acuity: Acuity): AdlStatus {
  if (acuity === 3) return "dependent";
  if (acuity === 2) return "assisted";
  return "independent";
}

function buildCareSummary(status: ResidencyStatus, acuity: Acuity): string {
  if (status === "hospital") return "Hospital hold - return coordination in progress";
  if (status === "loa") return "Approved leave of absence";
  if (acuity === 3) return "Enhanced monitoring and transfer support";
  if (acuity === 2) return "Routine assisted ADL support";
  return "Independent daily routine";
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function AcuityBadge({ acuity }: { acuity: Acuity }) {
  if (acuity === 3) {
    return (
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 gap-1.5 flex items-center shadow-[inset_0_0_10px_rgba(244,63,94,0.1)] px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest">
        <PulseDot className="h-1.5 w-1.5" colorClass="bg-rose-500" />
        Acuity 3
      </Badge>
    );
  }
  if (acuity === 2) {
    return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest">Acuity 2</Badge>;
  }
  return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest">Acuity 1</Badge>;
}

function AdlBadge({ status }: { status: AdlStatus }) {
  const map: Record<AdlStatus, { label: string; className: string }> = {
    independent: {
      label: "Independent",
      className: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-400",
    },
    assisted: {
      label: "Assisted",
      className: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    dependent: {
      label: "Dependent",
      className: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    },
  };

  return <Badge className={cn("px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest", map[status].className)}>{map[status].label}</Badge>;
}

function ResidentStatusBadge({ status }: { status: ResidencyStatus }) {
  const map: Record<ResidencyStatus, { label: string; className: string }> = {
    active: {
      label: "In Facility",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    hospital: {
      label: "Hospital",
      className: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    },
    loa: {
      label: "LOA",
      className: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
  };

  return <Badge className={cn("px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest", map[status].className)}>{map[status].label}</Badge>;
}
