"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, Clock, Download } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
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

type TimeRecordExportRow = Database["public"]["Tables"]["time_records"]["Row"] & {
  staff_display_name: string;
};

function buildTimeRecordsCsv(rows: TimeRecordExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "staff_id",
    "staff_display_name",
    "shift_assignment_id",
    "clock_in",
    "clock_out",
    "clock_in_method",
    "clock_out_method",
    "clock_in_latitude",
    "clock_in_longitude",
    "clock_out_latitude",
    "clock_out_longitude",
    "approved",
    "approved_at",
    "approved_by",
    "actual_hours",
    "regular_hours",
    "overtime_hours",
    "scheduled_hours",
    "break_minutes",
    "discrepancy_notes",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.staff_id),
      csvEscapeCell(row.staff_display_name),
      csvEscapeCell(row.shift_assignment_id ?? ""),
      csvEscapeCell(row.clock_in),
      csvEscapeCell(row.clock_out ?? ""),
      csvEscapeCell(row.clock_in_method),
      csvEscapeCell(row.clock_out_method ?? ""),
      csvEscapeCell(row.clock_in_latitude != null ? String(row.clock_in_latitude) : ""),
      csvEscapeCell(row.clock_in_longitude != null ? String(row.clock_in_longitude) : ""),
      csvEscapeCell(row.clock_out_latitude != null ? String(row.clock_out_latitude) : ""),
      csvEscapeCell(row.clock_out_longitude != null ? String(row.clock_out_longitude) : ""),
      csvEscapeCell(row.approved ? "true" : "false"),
      csvEscapeCell(row.approved_at ?? ""),
      csvEscapeCell(row.approved_by ?? ""),
      csvEscapeCell(row.actual_hours != null ? String(row.actual_hours) : ""),
      csvEscapeCell(row.regular_hours != null ? String(row.regular_hours) : ""),
      csvEscapeCell(row.overtime_hours != null ? String(row.overtime_hours) : ""),
      csvEscapeCell(row.scheduled_hours != null ? String(row.scheduled_hours) : ""),
      csvEscapeCell(row.break_minutes != null ? String(row.break_minutes) : ""),
      csvEscapeCell(row.discrepancy_notes ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
      csvEscapeCell(row.deleted_at ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

const DEFAULT_FILTERS = { search: "", approved: "all" };

export default function AdminTimeRecordsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<TimeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [approvingBulk, setApprovingBulk] = useState(false);
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

  const exportTimeRecordsCsv = useCallback(async () => {
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("time_records" as never)
        .select("*")
        .is("deleted_at", null)
        .order("clock_in", { ascending: false })
        .limit(500);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      if (approved === "yes") {
        q = q.eq("approved", true);
      } else if (approved === "no") {
        q = q.eq("approved", false);
      }

      const res = (await q) as unknown as QueryResult<Database["public"]["Tables"]["time_records"]["Row"]>;
      if (res.error) throw res.error;
      const list = res.data ?? [];
      const scope =
        approved === "all" ? "" : approved === "yes" ? "_approved" : "_not_approved";
      const stamp = format(new Date(), "yyyy-MM-dd");
      if (list.length === 0) {
        const csv = buildTimeRecordsCsv([]);
        triggerCsvDownload(`time-records-${stamp}${scope}.csv`, csv);
        return;
      }

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

      const exportRows: TimeRecordExportRow[] = list.map((t) => ({
        ...t,
        staff_display_name: nameById.get(t.staff_id) ?? "Unknown staff",
      }));

      const csv = buildTimeRecordsCsv(exportRows);
      triggerCsvDownload(`time-records-${stamp}${scope}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export time records.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId, approved]);

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

  const bulkApprovePending = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility to approve punches.");
      return;
    }
    const pending = rows.filter((r) => !r.approved && r.clockOut);
    if (pending.length === 0) return;

    setApprovingBulk(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      const now = new Date().toISOString();
      const ids = pending.map((r) => r.id);

      const { error: uErr } = await supabase
        .from("time_records" as never)
        .update({
          approved: true,
          approved_at: now,
          approved_by: user.id,
          updated_by: user.id,
        } as never)
        .in("id", ids)
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("approved", false)
        .not("clock_out", "is", null);

      if (uErr) throw uErr;

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk approve failed.");
    } finally {
      setApprovingBulk(false);
    }
  }, [load, rows, selectedFacilityId, supabase]);

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
        <div className="relative overflow-visible z-10 w-full mt-4">
          <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Recent punches</h3>
              <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">
                Newest first; open staff profile for employment context. Download includes up to 500 rows matching the
                approval filter above (search is list-only).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="font-mono text-[10px] uppercase tracking-widest border-amber-300 text-amber-900 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/40"
                disabled={
                  approvingBulk ||
                  exportingCsv ||
                  pendingApproval === 0 ||
                  !isValidFacilityIdForQuery(selectedFacilityId)
                }
                aria-busy={approvingBulk}
                onClick={() => void bulkApprovePending()}
              >
                {approvingBulk ? "Approving…" : `Approve all pending (${pendingApproval})`}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="font-mono text-[10px] uppercase tracking-widest"
                disabled={exportingCsv || approvingBulk}
                aria-busy={exportingCsv}
                onClick={() => void exportTimeRecordsCsv()}
              >
                <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                {exportingCsv ? "Exporting…" : "Download time records CSV"}
              </Button>
            </div>
          </div>
          <MotionList className="space-y-3">
            {filteredRows.map((row) => (
              <MotionItem key={row.id}>
                <Link href={`/admin/staff/${row.staffId}`} className="block focus-visible:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl">
                  <div className="p-4 sm:p-5 rounded-2xl glass-panel group transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full flex items-center justify-between">
                     <div className="flex flex-col md:flex-row md:items-center gap-4 w-full">
                       <div className="min-w-[150px]">
                         <span className="font-bold text-slate-900 dark:text-slate-100">{row.staffName}</span>
                       </div>
                       
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full items-center">
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Clock In</span>
                             <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{formatDateTime(row.clockIn)}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Clock Out</span>
                             <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{row.clockOut ? formatDateTime(row.clockOut) : "—"}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Hours</span>
                             <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{row.actualHours != null ? Number(row.actualHours).toFixed(2) : "—"}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Approved</span>
                             <div>
                               {row.approved ? (
                                  <Badge className="bg-emerald-500/20 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2">Yes</Badge>
                               ) : (
                                  <Badge className="bg-amber-500/20 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2">No</Badge>
                               )}
                             </div>
                          </div>
                       </div>
                     </div>
                     <div className="hidden sm:flex shrink-0 ml-4">
                        <div className="w-8 h-8 rounded-full bg-white/50 dark:bg-white/5 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                          <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                        </div>
                     </div>
                  </div>
                </Link>
              </MotionItem>
            ))}
          </MotionList>
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
