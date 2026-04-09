"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, CalendarDays, Download } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type ShiftAssignmentRow = Database["public"]["Tables"]["shift_assignments"]["Row"];
type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];

type AssignmentUi = {
  id: string;
  shiftDate: string;
  shiftType: string;
  shiftClassification: string;
  status: string;
  staffName: string;
  notes: string | null;
};

type SupabaseStaffMini = {
  id: string;
  first_name: string;
  last_name: string;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

type ShiftExportRow = ShiftAssignmentRow & { staff_display_name: string };

function buildShiftAssignmentsCsv(rows: ShiftExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "schedule_id",
    "staff_id",
    "staff_display_name",
    "shift_date",
    "shift_type",
    "shift_classification",
    "custom_start_time",
    "custom_end_time",
    "status",
    "unit_id",
    "notes",
    "assigned_resident_ids",
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
      csvEscapeCell(row.schedule_id),
      csvEscapeCell(row.staff_id),
      csvEscapeCell(row.staff_display_name),
      csvEscapeCell(row.shift_date),
      csvEscapeCell(row.shift_type),
      csvEscapeCell(row.shift_classification),
      csvEscapeCell(row.custom_start_time ?? ""),
      csvEscapeCell(row.custom_end_time ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.unit_id ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.assigned_resident_ids != null ? JSON.stringify(row.assigned_resident_ids) : ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
      csvEscapeCell(row.deleted_at ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

export default function AdminScheduleWeekDetailPage() {
  const params = useParams();
  const scheduleId = typeof params?.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [rows, setRows] = useState<AssignmentUi[]>([]);
  const [rawAssignments, setRawAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const facilityScopeOk = useMemo(() => {
    if (!schedule) return true;
    if (!isValidFacilityIdForQuery(selectedFacilityId)) return true;
    return schedule.facility_id === selectedFacilityId;
  }, [schedule, selectedFacilityId]);

  const load = useCallback(async () => {
    if (!scheduleId) {
      setError("Missing schedule id.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const schedRes = (await supabase
        .from("schedules" as never)
        .select("*")
        .eq("id", scheduleId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as { data: ScheduleRow | null; error: QueryError | null };
      if (schedRes.error) throw schedRes.error;
      if (!schedRes.data) {
        setSchedule(null);
        setRows([]);
        setRawAssignments([]);
        setError(null);
        setIsLoading(false);
        return;
      }
      setSchedule(schedRes.data);

      const assignRes = (await supabase
        .from("shift_assignments" as never)
        .select("*")
        .eq("schedule_id", scheduleId)
        .is("deleted_at", null)
        .order("shift_date", { ascending: true })
        .order("shift_type", { ascending: true })
        .limit(500)) as unknown as QueryResult<ShiftAssignmentRow>;
      if (assignRes.error) throw assignRes.error;
      const list = assignRes.data ?? [];
      setRawAssignments(list);

      if (list.length === 0) {
        setRows([]);
        return;
      }

      const staffIds = [...new Set(list.map((a) => a.staff_id))];
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
        const name = `${first} ${last}`.trim() || "Staff member";
        nameById.set(s.id, name);
      }

      setRows(
        list.map((a) => ({
          id: a.id,
          shiftDate: a.shift_date,
          shiftType: a.shift_type,
          shiftClassification: a.shift_classification,
          status: a.status,
          staffName: nameById.get(a.staff_id) ?? "Unknown staff",
          notes: a.notes,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule.");
      setSchedule(null);
      setRows([]);
      setRawAssignments([]);
    } finally {
      setIsLoading(false);
    }
  }, [scheduleId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportAssignmentsCsv = useCallback(() => {
    if (!schedule) return;
    setExportingCsv(true);
    setError(null);
    try {
      const nameById = new Map<string, string>();
      for (const a of rawAssignments) {
        const ui = rows.find((r) => r.id === a.id);
        nameById.set(a.staff_id, ui?.staffName ?? "Unknown staff");
      }

      const exportRows: ShiftExportRow[] = rawAssignments.map((row) => ({
        ...row,
        staff_display_name: nameById.get(row.staff_id) ?? "Unknown staff",
      }));

      const csv = buildShiftAssignmentsCsv(exportRows);
      const week = schedule.week_start_date.replace(/[^0-9-]/g, "") || "week";
      triggerCsvDownload(`shift-assignments-${week}-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [schedule, rawAssignments, rows]);

  const weekLabel = schedule ? formatWeekLabel(schedule.week_start_date) : "";

  return (
    <div className="relative min-h-[70vh]">
      <AmbientMatrix
        hasCriticals={false}
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-blue-900/10"
      />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <Link
            href="/admin/schedules"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 mb-4")}
          >
            <ArrowLeft className="h-4 w-4" />
            Schedule weeks
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-7 w-7 text-indigo-500" />
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {schedule ? weekLabel : "Schedule week"}
            </h1>
          </div>
          {schedule ? (
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">
              Status: <ScheduleStatusBadge status={schedule.status} /> · Published:{" "}
              {schedule.published_at ? formatDateTime(schedule.published_at) : "—"}
            </p>
          ) : null}
          {schedule?.notes ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">{schedule.notes}</p>
          ) : null}
        </div>

        {!facilityScopeOk ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            This schedule belongs to another facility. Choose the matching facility in the header to align with
            operations context (RLS may still limit what you see).
          </div>
        ) : null}

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-2">
          <div className="col-span-1 md:col-span-2 h-[120px]">
            <V2Card hoverColor="indigo" className="h-full flex flex-col justify-center relative overflow-hidden">
              <MonolithicWatermark value={rows.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 px-4">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <PulseDot className="text-indigo-500" /> Shift assignments
                </h3>
                <p className="text-3xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">
                  {rows.length}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Up to 500 rows loaded for this week container.</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 h-[120px]">
            <V2Card hoverColor="blue" className="h-full flex flex-col justify-center items-start">
              <div className="relative z-10 px-4 w-full">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Export</p>
                <Sparkline />
              </div>
            </V2Card>
          </div>
        </KineticGrid>

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && error ? (
          <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
        ) : null}
        {!isLoading && !schedule && !error ? (
          <AdminEmptyState
            title="Schedule not found"
            description="This week may have been removed or you may not have access."
          />
        ) : null}

        {!isLoading && schedule ? (
          <div className="relative overflow-visible z-10 w-full mt-2">
            <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  Assignments
                </h3>
                <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">
                  Read-only list for this schedule week. Full builder grid ships in a later slice.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 font-mono text-[10px] uppercase tracking-widest"
                disabled={exportingCsv || rawAssignments.length === 0}
                aria-busy={exportingCsv}
                onClick={() => exportAssignmentsCsv()}
              >
                <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                {exportingCsv ? "Exporting…" : "Download assignments CSV"}
              </Button>
            </div>

            {rows.length === 0 ? (
              <AdminEmptyState
                title="No shift assignments yet"
                description="Add assignments from scheduling tools when the builder is available."
              />
            ) : (
              <MotionList className="space-y-3">
                {rows.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="p-4 sm:p-5 rounded-2xl glass-panel border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{row.staffName}</span>
                        <span className="text-xs text-slate-500">{formatIsoDate(row.shiftDate)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <Badge className="font-mono text-[9px] uppercase tracking-widest">{row.shiftType}</Badge>
                        <Badge variant="outline" className="font-mono text-[9px]">
                          {row.shiftClassification}
                        </Badge>
                        <AssignmentStatusBadge status={row.status} />
                        {row.notes ? (
                          <span className="text-xs text-slate-500 max-w-md truncate" title={row.notes}>
                            {row.notes}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatWeekLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return `Week of ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(parsed)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function formatIsoDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-slate-200/50 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300" },
    published: {
      label: "Published",
      className: "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400",
    },
    archived: { label: "Archived", className: "bg-slate-200/50 text-slate-800" },
  };
  const m = map[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return <Badge className={cn("uppercase tracking-widest font-mono text-[9px] font-bold border-0", m.className)}>{m.label}</Badge>;
}

function AssignmentStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <Badge variant="secondary" className="font-mono text-[9px] uppercase tracking-widest">
      {label}
    </Badge>
  );
}
