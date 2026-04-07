"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type TimeRow = {
  id: string;
  staffId: string;
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  approved: boolean;
  actualHours: number | null;
};

type SupabaseTimeRow = {
  id: string;
  staff_id: string;
  clock_in: string;
  clock_out: string | null;
  approved: boolean;
  actual_hours: number | string | null;
  deleted_at: string | null;
};

type SupabaseStaffMini = {
  id: string;
  first_name: string;
  last_name: string;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

const DEFAULT_FILTERS = { search: "", approved: "all" };

export default function AdminTimeRecordsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<TimeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [approved, setApproved] = useState(DEFAULT_FILTERS.approved);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchTimeRecordsFromSupabase(selectedFacilityId);
      setRows(live);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = q.length === 0 || row.staffName.toLowerCase().includes(q);
      const matchesApproved =
        approved === "all" ||
        (approved === "yes" && row.approved) ||
        (approved === "no" && !row.approved);
      return matchesSearch && matchesApproved;
    });
  }, [rows, search, approved]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No time records in this scope",
          description:
            "Live data returned no punches for the selected facility or organization filter. Use Add time record for manual corrections or wait for staff clock events.",
        },
        whenFiltersExcludeAll: {
          title: "No time records match the current filters",
          description:
            "Punches appear as caregivers clock in and out. Scope follows your facility selector.",
        },
      }),
    [rows.length],
  );

  const pendingApproval = rows.filter((r) => !r.approved && r.clockOut).length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={pendingApproval > 0} 
        primaryClass="bg-blue-700/10"
        secondaryClass="bg-indigo-900/10"
        criticalPrimaryClass="bg-amber-700/20"
        criticalSecondaryClass="bg-orange-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 18 / Time Records</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Time & Attendance {pendingApproval > 0 && <PulseDot colorClass="bg-amber-500" />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="orange" className="border-amber-500/20 dark:border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]">
              <Sparkline colorClass="text-amber-500" variant={4} />
              <MonolithicWatermark value={pendingApproval} className="text-amber-600/5 dark:text-amber-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" /> Pending Approval
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">{pendingApproval}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-3 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Recent clock activity with approval state for payroll readiness.</p>
                 <Link href="/admin/time-records/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                   + Log Manual Time
                 </Link>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search staff name..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "approved",
            value: approved,
            onChange: setApproved,
            options: [
              { value: "all", label: "All approval states" },
              { value: "yes", label: "Approved" },
              { value: "no", label: "Not approved" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setApproved(DEFAULT_FILTERS.approved);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
          <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Recent punches</h3>
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Newest first; open staff profile for employment context.</p>
          </div>
          <div className="relative z-10 overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead className="hidden sm:table-cell">Clock in</TableHead>
                  <TableHead className="hidden sm:table-cell">Clock out</TableHead>
                  <TableHead className="hidden md:table-cell">Hours</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead className="pr-4 text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-blue-500/5 dark:hover:bg-blue-500/10 transition-colors cursor-pointer group">
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{row.staffName}</TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                      {formatDateTime(row.clockIn)}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                      {row.clockOut ? formatDateTime(row.clockOut) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                      {row.actualHours != null ? Number(row.actualHours).toFixed(2) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.approved ? (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Yes
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          No
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/staff/${row.staffId}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open ${row.staffName}`}
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

async function fetchTimeRecordsFromSupabase(selectedFacilityId: string | null): Promise<TimeRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("time_records" as never)
    .select("id, staff_id, clock_in, clock_out, approved, actual_hours, deleted_at")
    .is("deleted_at", null)
    .order("clock_in", { ascending: false })
    .limit(150);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SupabaseTimeRow>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  if (list.length === 0) return [];

  const staffIds = [...new Set(list.map((t) => t.staff_id))];
  const staffRes = (await supabase
    .from("staff" as never)
    .select("id, first_name, last_name, deleted_at")
    .in("id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffMini>;
  if (staffRes.error) throw staffRes.error;

  const nameById = new Map<string, string>();
  for (const s of staffRes.data ?? []) {
    const first = s.first_name?.trim() ?? "";
    const last = s.last_name?.trim() ?? "";
    nameById.set(s.id, `${first} ${last}`.trim() || "Staff member");
  }

  return list.map((t) => ({
    id: t.id,
    staffId: t.staff_id,
    staffName: nameById.get(t.staff_id) ?? "Unknown staff",
    clockIn: t.clock_in,
    clockOut: t.clock_out,
    approved: t.approved,
    actualHours: t.actual_hours == null ? null : Number(t.actual_hours),
  }));
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
