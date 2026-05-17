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
import { V2Card } from "@/components/ui/v2-card";
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
      <></>
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              Time & Attendance {pendingApproval > 0 && <></>}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="orange" className="border-amber-500/20 dark:border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]">
              <></>
              <MonolithicWatermark value={pendingApproval} className="text-warning/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-medium tracking-wider uppercase text-warning flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" /> Pending Approval
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-warning pb-1 tabular-nums">{pendingApproval}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-3 h-[180px]">
            <V2Card hoverColor="blue" className="p-5 lg:p-6">
              <div className="relative z-10 flex h-full w-full flex-col justify-center gap-4 text-left lg:items-end lg:text-right">
                 <p className="hidden max-w-md text-xs leading-relaxed text-muted-foreground lg:block">Recent clock activity with approval state for payroll readiness.</p>
                 <Link href="/admin/time-records/new" className={cn(buttonVariants({ size: "default" }), "font-medium uppercase tracking-wider text-[10px] tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground border-none whitespace-nowrap")} >
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
          <div className="flex items-center gap-3 px-[13px] py-2 mb-4 rounded-[var(--radius)] border border-border bg-card/60 flex-col sm:flex-row sm:items-start sm:justify-between relative z-10">
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-1">Recent punches</h3>
              <p className="text-sm tracking-wide text-muted-foreground">
                Newest first; open staff profile for employment context. Download includes up to 500 rows matching the
                approval filter above (search is list-only).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="font-medium text-[10px] uppercase tracking-wider border-warning/40 text-warning hover:bg-warning/10"
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
                className="font-medium text-[10px] uppercase tracking-wider"
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
                <Link href={`/admin/staff/${row.staffId}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 rounded-[9px]">
                  <div className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] cursor-pointer w-full justify-between">
                     <div className="flex flex-col md:flex-row md:items-center gap-4 w-full">
                       <div className="min-w-[150px]">
                         <span className="font-bold text-foreground">{row.staffName}</span>
                       </div>
                       
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full items-center">
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-medium tracking-wider text-muted-foreground">Clock In</span>
                             <span className="font-mono text-xs text-foreground tabular-nums">{formatDateTime(row.clockIn)}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-medium tracking-wider text-muted-foreground">Clock Out</span>
                             <span className="font-mono text-xs text-foreground tabular-nums">{row.clockOut ? formatDateTime(row.clockOut) : "—"}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-medium tracking-wider text-muted-foreground">Hours</span>
                             <span className="font-mono text-xs font-bold text-info tabular-nums">{row.actualHours != null ? Number(row.actualHours).toFixed(2) : "—"}</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                             <span className="text-[9px] uppercase font-medium tracking-wider text-muted-foreground">Approved</span>
                             <div>
                               {row.approved ? (
                                  <Badge className="bg-success/10 text-success border border-success/30 uppercase tracking-wider font-medium text-[9px] font-bold shadow-sm px-2">Yes</Badge>
                               ) : (
                                  <Badge className="bg-warning/10 text-warning border border-warning/30 uppercase tracking-wider font-medium text-[9px] font-bold shadow-sm px-2">No</Badge>
                               )}
                             </div>
                          </div>
                       </div>
                     </div>
                     <div className="hidden sm:flex shrink-0 ml-4">
                        <div className="w-8 h-8 rounded-full bg-muted/40 flex items-center justify-center transition-colors">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
