"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronRight, Users } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

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
};

export default function AdminResidentsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ResidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [acuity, setAcuity] = useState(DEFAULT_FILTERS.acuity);
  const [unit, setUnit] = useState(DEFAULT_FILTERS.unit);
  const [adl, setAdl] = useState(DEFAULT_FILTERS.adl);

  const loadResidents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const liveRows = await fetchResidentsFromSupabase(selectedFacilityId);
      if (liveRows.length > 0) {
        setRows(liveRows);
      } else {
        // DEMO HYDRATION: Provide rich visual data for CEO demo if DB is unseeded
        setRows([
          { id: "m1", name: "Margaret Sullivan", initials: "MS", room: "101-A", unit: "East Wing", acuity: 2, adlStatus: "assisted", status: "active", careSummary: "Routine assisted ADL support", updatedAt: "Oct 12, 09:42 AM" },
          { id: "m2", name: "Arthur Pendelton", initials: "AP", room: "102-B", unit: "East Wing", acuity: 1, adlStatus: "independent", status: "active", careSummary: "Independent daily routine", updatedAt: "Oct 12, 08:30 AM" },
          { id: "m3", name: "Eleanor Vance", initials: "EV", room: "104-A", unit: "Memory Care", acuity: 3, adlStatus: "dependent", status: "hospital", careSummary: "Hospital hold - return coordination in progress", updatedAt: "Oct 11, 11:15 PM" },
          { id: "m4", name: "Robert Chen", initials: "RC", room: "201-A", unit: "West Wing", acuity: 1, adlStatus: "independent", status: "active", careSummary: "Independent daily routine", updatedAt: "Oct 10, 04:20 PM" },
          { id: "m5", name: "Lucille Booth", initials: "LB", room: "205-B", unit: "West Wing", acuity: 2, adlStatus: "assisted", status: "active", careSummary: "Routine assisted ADL support", updatedAt: "Oct 12, 07:10 AM" },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

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
      const matchesAcuity = acuity === "all" || String(row.acuity) === acuity;
      const matchesUnit = unit === "all" || row.unit === unit;
      const matchesAdl = adl === "all" || row.adlStatus === adl;

      return matchesSearch && matchesAcuity && matchesUnit && matchesAdl;
    });
  }, [rows, search, acuity, unit, adl]);

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
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 08 / Residents</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Resident Hub {highAcuityCount > 0 && <PulseDot />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald">
              <Sparkline colorClass="text-emerald-500" variant={1} />
              <MonolithicWatermark value={activeCount} className="text-emerald-900/5 dark:text-emerald-100/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" /> Total Census
                </h3>
                <p className="text-4xl font-mono tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-500 pb-1">{activeCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="rose" className="border-rose-500/20 dark:border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]">
              <Sparkline colorClass="text-rose-500" variant={4} />
              <MonolithicWatermark value={highAcuityCount} className="text-rose-600/5 dark:text-rose-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                  High Acuity Profile
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-rose-600 dark:text-rose-400 pb-1">{highAcuityCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="indigo" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Unified census view with acuity & ADL scope</p>
                <Link href="/admin/residents/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                  + Initialize Intake
                </Link>
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
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setAcuity(DEFAULT_FILTERS.acuity);
          setUnit(DEFAULT_FILTERS.unit);
          setAdl(DEFAULT_FILTERS.adl);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadResidents()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && filteredRows.length > 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
          <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Census Table</h3>
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Filterable scaffold pattern for Residents, Incidents, Staff, and Billing modules.</p>
          </div>
          <div className="relative z-10 overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead className="pl-4 font-medium">Resident</TableHead>
                  <TableHead className="font-medium">Room</TableHead>
                  <TableHead className="font-medium">Unit</TableHead>
                  <TableHead className="font-medium">Acuity</TableHead>
                  <TableHead className="font-medium">ADL Status</TableHead>
                  <TableHead className="font-medium">Current Status</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Updated
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((resident) => (
                  <TableRow key={resident.id} className="border-slate-100 dark:border-slate-800 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer group">
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-700"
                          aria-hidden
                        >
                          {resident.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{resident.name}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{resident.careSummary}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{resident.room}</TableCell>
                    <TableCell>{resident.unit}</TableCell>
                    <TableCell>
                      <AcuityBadge acuity={resident.acuity} />
                    </TableCell>
                    <TableCell>
                      <AdlBadge status={resident.adlStatus} />
                    </TableCell>
                    <TableCell>
                      <ResidentStatusBadge status={resident.status} />
                    </TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{resident.updatedAt}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/residents/${resident.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open ${resident.name}`}
                      >
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 gap-1.5 flex items-center shadow-[inset_0_0_10px_rgba(244,63,94,0.1)]">
        <PulseDot className="h-1.5 w-1.5" />
        Acuity 3
      </Badge>
    );
  }
  if (acuity === 2) {
    return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">Acuity 2</Badge>;
  }
  return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Acuity 1</Badge>;
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

  return <Badge className={map[status].className}>{map[status].label}</Badge>;
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

  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
