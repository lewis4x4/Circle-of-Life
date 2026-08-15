"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { Download } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { formatSchedulePublishedSubtitle } from "@/lib/schedules/schedules-display-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { cn } from "@/lib/utils";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";
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
      setError(formatLiveDataLoadError(err, "Failed to load schedule."));
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
    <div className="space-y-6">
      <RecordDetailHeader
        title={schedule ? weekLabel : "Schedule week"}
        subtitle={
          schedule ? formatSchedulePublishedSubtitle(schedule.published_at, schedule.notes) : undefined
        }
        statusChips={schedule ? <ScheduleStatusBadge status={schedule.status} /> : undefined}
        backLink={{ label: "Schedule weeks", href: "/admin/schedules" }}
        actions={
          rawAssignments.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => exportAssignmentsCsv()}
            >
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Download assignments CSV"}
            </Button>
          ) : undefined
        }
      />

      {!facilityScopeOk ? (
        <div
          className="rounded-[8px] border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning"
          role="status"
        >
          This schedule belongs to another facility. Choose the matching facility in the header to align with
          operations context (RLS may still limit what you see).
        </div>
      ) : null}

      <div className="flex items-center gap-4 px-1 tabular-nums">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Shift assignments
          </p>
          <p className="text-2xl font-semibold text-foreground">{rows.length}</p>
          <p className="text-xs text-muted-foreground">Up to 500 rows loaded for this week container.</p>
        </div>
      </div>

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
          <RecordDetailSection
            title="Assignments"
            description="Read-only list for this schedule week. Full builder grid ships in a later slice."
          >
            {rows.length === 0 ? (
              <AdminEmptyState
                title="No shift assignments yet"
                description="Add assignments from scheduling tools when the builder is available."
              />
            ) : (
              <MotionList className="space-y-3">
                {rows.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="flex w-full flex-col gap-3 rounded-[8px] border border-border bg-card p-4 transition-[transform,box-shadow] duration-[var(--motion-duration)] hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-foreground">{row.staffName}</span>
                        <span className="text-xs text-muted-foreground">{formatIsoDate(row.shiftDate)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="font-mono text-[9px] uppercase tracking-wider">{row.shiftType}</Badge>
                        <Badge variant="outline" className="font-mono text-[9px]">
                          {row.shiftClassification}
                        </Badge>
                        <AssignmentStatusBadge status={row.status} />
                        {row.notes ? (
                          <span className="max-w-md truncate text-xs text-muted-foreground" title={row.notes}>
                            {row.notes}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </RecordDetailSection>
        ) : null}
    </div>
  );
}

function formatWeekLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return `Week of ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(parsed)}`;
}

function formatIsoDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
    published: {
      label: "Published",
      className: "bg-success/10 text-success",
    },
    archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return <Badge className={cn("uppercase tracking-wider text-[9px] font-bold border-0", m.className)}>{m.label}</Badge>;
}

function AssignmentStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <Badge variant="secondary" className="font-mono text-[9px] uppercase tracking-wider">
      {label}
    </Badge>
  );
}
