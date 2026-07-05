"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Users, Clock, FileWarning, CalendarPlus, Activity, Download, Loader2 } from "lucide-react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import {
  fetchAttendanceEvents,
  fetchExpiredCertificationWarnings,
  fetchShiftAssignmentGaps,
  fetchSnapshotsFromSupabase,
  fetchStaffOptions,
  fetchStaffRequisitions,
  type AttendanceEventRow,
  type CertWarning,
  type RequisitionRow,
  type RequisitionStatus,
  type ShiftGap,
  type SnapshotRow,
  type StaffOption,
} from "@/lib/staffing/load-staffing-console";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminEmptyState, AdminErrorState } from "@/components/common/admin-list-patterns";

type ComplianceFilter = "all" | "non_compliant" | "compliant";
type WindowFilter = "all" | "24h";

type StaffingSnapshotCsvRow = Database["public"]["Tables"]["staffing_ratio_snapshots"]["Row"];
type QueryError = { message: string };

function buildStaffingSnapshotsCsv(rows: StaffingSnapshotCsvRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "snapshot_at",
    "shift",
    "residents_present",
    "staff_on_duty",
    "ratio",
    "required_ratio",
    "is_compliant",
    "staff_detail_json",
    "created_at",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.snapshot_at),
      csvEscapeCell(row.shift),
      csvEscapeCell(String(row.residents_present)),
      csvEscapeCell(String(row.staff_on_duty)),
      csvEscapeCell(String(row.ratio)),
      csvEscapeCell(String(row.required_ratio)),
      csvEscapeCell(row.is_compliant ? "true" : "false"),
      csvEscapeCell(row.staff_detail != null ? JSON.stringify(row.staff_detail) : ""),
      csvEscapeCell(row.created_at),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

type AdminStaffingConsolePageClientProps = {
  initialSnapshots: SnapshotRow[];
  initialCertWarnings: CertWarning[];
  initialShiftGaps: ShiftGap[];
  initialStaffOptions: StaffOption[];
  initialRequisitions: RequisitionRow[];
  initialAttendance: AttendanceEventRow[];
  initialError: string | null;
  initialFacilityId: string | null;
};

const panelClass = "rounded-lg border border-border bg-card p-5 shadow-sm";
const fieldClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const listShellClass = "overflow-hidden rounded-lg border border-border bg-background/50";
const listRowClass = "px-4 py-3";

export function AdminStaffingConsolePageClient({
  initialSnapshots,
  initialCertWarnings,
  initialShiftGaps,
  initialStaffOptions,
  initialRequisitions,
  initialAttendance,
  initialError,
  initialFacilityId,
}: AdminStaffingConsolePageClientProps) {
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { user } = useHavenAuth();
  const userId = user?.id ?? null;
  const { selectedFacilityId } = useFacilityStore();
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>(initialSnapshots);
  const [certWarnings, setCertWarnings] = useState<CertWarning[]>(initialCertWarnings);
  const [shiftGaps, setShiftGaps] = useState<ShiftGap[]>(initialShiftGaps);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [csvExportError, setCsvExportError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>(initialStaffOptions);
  const [requisitionRows, setRequisitionRows] = useState<RequisitionRow[]>(initialRequisitions);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceEventRow[]>(initialAttendance);
  const [attendanceStaffId, setAttendanceStaffId] = useState("");
  const [attendanceEventType, setAttendanceEventType] = useState("callout");
  const [attendanceOccurredAt, setAttendanceOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [attendanceReason, setAttendanceReason] = useState("");
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [requisitionTitle, setRequisitionTitle] = useState("");
  const [requisitionRoleTarget, setRequisitionRoleTarget] = useState("");
  const [requisitionDepartment, setRequisitionDepartment] = useState("");
  const [requisitionTargetHireDate, setRequisitionTargetHireDate] = useState("");
  const [requisitionSaving, setRequisitionSaving] = useState(false);
  const [requisitionStatusDrafts, setRequisitionStatusDrafts] = useState<Record<string, RequisitionStatus>>(
    () => Object.fromEntries(initialRequisitions.map((row) => [row.id, row.status])),
  );
  const [requisitionUpdatingId, setRequisitionUpdatingId] = useState<string | null>(null);
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>("all");
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");

  // Skip the first client-side load when the server already supplied data for
  // the current facility. Facility scope changes still refetch client-side.
  const skipNextLoadRef = useRef(initialError == null);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setIsLoading(true);
    setError(null);
    try {
      const [liveSnapshots, liveCertWarnings, liveShiftGaps, liveStaffOptions, liveRequisitions, liveAttendance] = await Promise.all([
        fetchSnapshotsFromSupabase(selectedFacilityId),
        fetchExpiredCertificationWarnings(selectedFacilityId),
        fetchShiftAssignmentGaps(selectedFacilityId),
        fetchStaffOptions(selectedFacilityId),
        fetchStaffRequisitions(selectedFacilityId),
        fetchAttendanceEvents(selectedFacilityId),
      ]);
      setSnapshots(liveSnapshots);
      setCertWarnings(liveCertWarnings);
      setShiftGaps(liveShiftGaps);
      setStaffOptions(liveStaffOptions);
      setRequisitionRows(liveRequisitions);
      setAttendanceRows(liveAttendance);
      setRequisitionStatusDrafts(
        Object.fromEntries(liveRequisitions.map((row) => [row.id, row.status])),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staffing metrics");
      setCertWarnings([]);
      setShiftGaps([]);
      setStaffOptions([]);
      setRequisitionRows([]);
      setAttendanceRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requestedFilter = searchParams.get("compliance");
    const requestedWindow = searchParams.get("window");
    if (requestedFilter === "non_compliant" || requestedFilter === "compliant") {
      setComplianceFilter(requestedFilter);
    } else {
      setComplianceFilter("all");
    }
    if (requestedWindow === "24h") {
      setWindowFilter("24h");
      return;
    }
    setWindowFilter("all");
  }, [searchParams]);

  const windowScopedSnapshots = useMemo(() => {
    return snapshots.filter((snapshot) => {
      return (
        windowFilter === "all" ||
        new Date(snapshot.snapshotAt).getTime() >= Date.now() - 24 * 3_600_000
      );
    });
  }, [snapshots, windowFilter]);

  const visibleSnapshots = useMemo(() => {
    return windowScopedSnapshots.filter((snapshot) => {
      return (
        complianceFilter === "all" ||
        (complianceFilter === "non_compliant" ? !snapshot.isCompliant : snapshot.isCompliant)
      );
    });
  }, [complianceFilter, windowScopedSnapshots]);

  const exportStaffingSnapshotsCsv = useCallback(async () => {
    setExportingCsv(true);
    setCsvExportError(null);
    try {
      const stamp = format(new Date(), "yyyy-MM-dd");
      if (visibleSnapshots.length === 0) {
        triggerCsvDownload(`staffing-ratio-snapshots-${stamp}.csv`, buildStaffingSnapshotsCsv([]));
        return;
      }

      const snapshotIdsInOrder = visibleSnapshots.map((s) => s.id);
      const res = await supabase
        .from("staffing_ratio_snapshots" as never)
        .select("*")
        .in("id", snapshotIdsInOrder)
        .order("snapshot_at", { ascending: false });
      if (res.error) throw res.error;
      const raw = (res.data ?? []) as StaffingSnapshotCsvRow[];
      const order = new Map(snapshotIdsInOrder.map((id, i) => [id, i]));
      const list = raw.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      const csv = buildStaffingSnapshotsCsv(list);
      triggerCsvDownload(`staffing-ratio-snapshots-${stamp}.csv`, csv);
    } catch (e) {
      setCsvExportError(e instanceof Error ? e.message : "Failed to export staffing snapshots.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, visibleSnapshots]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-[140px] rounded-2xl" />
          <Skeleton className="h-[140px] rounded-2xl" />
          <Skeleton className="h-[140px] rounded-2xl" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-2xl mt-6" />
      </div>
    );
  }

  if (error) {
    return (
      <AdminErrorState
        title="Workforce console unavailable"
        message={error}
        onRetry={() => void load()}
      />
    );
  }

  const latestVisibleSnapshot = visibleSnapshots[0] ?? null;
  const currentRatio = latestVisibleSnapshot?.ratio ?? null;
  const requiredRatio = latestVisibleSnapshot?.requiredRatio ?? null;
  const ratioDelta =
    currentRatio != null && requiredRatio != null
      ? currentRatio - requiredRatio
      : null;
  const ratioCardTone =
    latestVisibleSnapshot == null
      ? "text-slate-500"
      : latestVisibleSnapshot.isCompliant
        ? "text-emerald-500"
        : "text-amber-500";
  const ratioStatusCopy =
    latestVisibleSnapshot == null
      ? "No staffing snapshot is available for the current slice."
      : ratioDelta != null && ratioDelta > 0
        ? `${ratioDelta.toFixed(1)} above the required ratio on the latest ${latestVisibleSnapshot.shift} snapshot.`
        : ratioDelta != null
          ? `${Math.abs(ratioDelta).toFixed(1)} below the required ratio on the latest ${latestVisibleSnapshot.shift} snapshot.`
          : "Latest staffing snapshot loaded for this slice.";
  const openShiftShortage = shiftGaps.reduce((sum, gap) => sum + gap.shortage, 0);
  const openShiftCopy =
    openShiftShortage > 0
      ? `${openShiftShortage} unfilled ${openShiftShortage === 1 ? "role" : "roles"} in the next 48 hours.`
      : "No open shift gaps in the next 48 hours.";
  const credentialCopy =
    certWarnings.length > 0
      ? `${certWarnings.length} expired ${certWarnings.length === 1 ? "credential" : "credentials"} require review.`
      : "No expired credentials in this scope.";
  const scopeBlockerMessage =
    selectedFacilityId == null
      ? "Select a facility to load staffing metrics and enable requisition and attendance actions."
      : null;
  const adpStaffBlocker =
    selectedFacilityId != null && staffOptions.length === 0
        ? "No active staff came back from the ADP-linked directory for this facility. Attendance logging is blocked until the feed syncs."
        : null;
  // Single pass over the snapshots (this runs after an early return, so it
  // can't be a hook); derive both counts from one filter instead of two.
  const compliantCount = windowScopedSnapshots.filter((s) => s.isCompliant).length;
  const complianceOptions: Array<{ value: ComplianceFilter; label: string }> = [
    { value: "all", label: `All (${windowScopedSnapshots.length})` },
    { value: "non_compliant", label: `Non-compliant (${windowScopedSnapshots.length - compliantCount})` },
    { value: "compliant", label: `Compliant (${compliantCount})` },
  ];

  const attendanceLocked = scopeBlockerMessage != null || adpStaffBlocker != null;
  const requisitionLocked = scopeBlockerMessage != null;
  const attendanceEmptyTitle = attendanceLocked ? "Attendance logging blocked" : "No attendance events yet";
  const attendanceEmptyDescription = attendanceLocked
    ? adpStaffBlocker != null
      ? "Once the active staff directory syncs, attendance events will appear here."
      : "Select a facility to begin logging attendance events."
    : "Attendance logging will appear here once staff callouts or late arrivals are recorded for this scope.";
  const requisitionEmptyTitle = requisitionLocked ? "Requisitions blocked" : "No open requisitions";
  const requisitionEmptyDescription = requisitionLocked
    ? "Select a facility to create requisitions and track hiring needs here."
    : "Create a requisition when a shift opens up or a role needs to be backfilled.";

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Workforce command</Badge>
            {selectedFacilityId ? (
              <Badge variant="secondary">Facility scoped</Badge>
            ) : (
              <Badge tone="warning">No facility selected</Badge>
            )}
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Workforce Command
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Operational staffing, schedule gaps, attendance events, and credential blockers for the selected scope.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/staff" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
              View roster
            </Link>
            <Link href="/admin/schedules" className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-9")}>
              Master schedule
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportStaffingSnapshotsCsv()}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              {exportingCsv ? "Exporting..." : "Snapshots CSV"}
            </Button>
          </div>
          {csvExportError ? (
            <p className="max-w-md text-xs text-rose-600 dark:text-rose-400" role="alert">
              {csvExportError}
            </p>
          ) : null}
        </div>
      </header>

      {complianceFilter !== "all" || windowFilter !== "all" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{visibleSnapshots.length} visible snapshots</Badge>
          {complianceFilter !== "all" ? (
            <Badge variant="outline">
              {complianceFilter === "non_compliant" ? "Non-compliant only" : "Compliant only"}
            </Badge>
          ) : null}
          {windowFilter !== "all" ? <Badge variant="outline">Last 24 hours</Badge> : null}
          <Link href="/admin/staffing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}>
            Clear filters
          </Link>
        </div>
      ) : null}

      {scopeBlockerMessage ? (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
        >
          {scopeBlockerMessage}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3" aria-label="Workforce status">
        <div className={panelClass}>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" aria-hidden />
            Current ratio
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span className={cn("text-3xl font-semibold tabular-nums", ratioCardTone)}>
              {currentRatio != null ? currentRatio.toFixed(1) : "--"}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">
              {requiredRatio != null ? `required ${requiredRatio.toFixed(1)}` : "no live snapshot"}
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{ratioStatusCopy}</p>
        </div>

        <div
          className={cn(
            panelClass,
            openShiftShortage > 0 ? "border-rose-200 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20" : "",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Users className="h-4 w-4" aria-hidden />
            Open shifts (48h)
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                openShiftShortage > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground",
              )}
            >
              {openShiftShortage}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">roles unfilled</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{openShiftCopy}</p>
        </div>

        <Link
          href="/admin/certifications?timeline=expired"
          className={cn(
            panelClass,
            "block transition-colors hover:border-amber-300 hover:bg-amber-50/60 dark:hover:border-amber-900/60 dark:hover:bg-amber-950/20",
            certWarnings.length > 0 ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20" : "",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileWarning className="h-4 w-4" aria-hidden />
            Expired credentials
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                certWarnings.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground",
              )}
            >
              {certWarnings.length}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">blockers</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{credentialCopy}</p>
        </Link>
      </section>

      <section className="grid gap-6 xl:grid-cols-2" aria-label="Workforce actions">
        <div className={panelClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">Log attendance event</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Capture callouts and exceptions for the current staffing scope.
              </p>
            </div>
            <Badge variant="secondary">Standup input</Badge>
          </div>

          {adpStaffBlocker ? (
            <div
              role="status"
              className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
            >
              {adpStaffBlocker}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Staff member
              <select
                className={fieldClass}
                value={attendanceStaffId}
                onChange={(e) => setAttendanceStaffId(e.target.value)}
                disabled={attendanceLocked || attendanceSaving}
              >
                <option value="">Select staff member</option>
                {staffOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Event type
                <select
                  className={fieldClass}
                  value={attendanceEventType}
                  onChange={(e) => setAttendanceEventType(e.target.value)}
                  disabled={attendanceLocked || attendanceSaving}
                >
                  <option value="callout">Callout</option>
                  <option value="late_callout">Late callout</option>
                  <option value="no_show">No show</option>
                  <option value="left_early">Left early</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Occurred at
                <input
                  type="datetime-local"
                  className={fieldClass}
                  value={attendanceOccurredAt}
                  onChange={(e) => setAttendanceOccurredAt(e.target.value)}
                  disabled={attendanceLocked || attendanceSaving}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              Reason or note
              <input
                className={fieldClass}
                placeholder="Reason / note"
                value={attendanceReason}
                onChange={(e) => setAttendanceReason(e.target.value)}
                disabled={attendanceLocked || attendanceSaving}
              />
            </label>
            <Button
              type="button"
              className="mt-1 w-fit"
              disabled={attendanceSaving || attendanceLocked || !attendanceStaffId || !selectedFacilityId}
              onClick={() =>
                void createAttendanceEvent({
                  supabase,
                  userId,
                  selectedFacilityId,
                  attendanceStaffId,
                  attendanceEventType,
                  attendanceOccurredAt,
                  attendanceReason,
                  setError,
                  setAttendanceSaving,
                  onSaved: async () => {
                    setAttendanceStaffId("");
                    setAttendanceReason("");
                    await load();
                  },
                })
              }
            >
              {attendanceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save attendance event
            </Button>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-foreground">Recent attendance events</h4>
              <Badge variant="outline">{attendanceRows.length}</Badge>
            </div>
            {attendanceRows.length === 0 ? (
              <div className="mt-3">
                <AdminEmptyState
                  title={attendanceEmptyTitle}
                  description={attendanceEmptyDescription}
                />
              </div>
            ) : (
              <div className={cn(listShellClass, "mt-3 divide-y divide-border")}>
                {attendanceRows.map((row) => (
                  <div key={row.id} className={cn(listRowClass, "flex items-start justify-between gap-4")}>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">
                        {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Staff member"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="capitalize">
                          {row.event_type.replace(/_/g, " ")}
                        </Badge>
                        <span>{new Date(row.occurred_at).toLocaleString()}</span>
                      </div>
                      {row.reason ? <p className="mt-2 text-sm text-muted-foreground">{row.reason}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">Open positions</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Track requisitions and their status without leaving the staffing console.
              </p>
            </div>
            <Badge variant="secondary">Requisitions</Badge>
          </div>

          {scopeBlockerMessage ? (
            <div
              role="status"
              className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
            >
              {scopeBlockerMessage}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Role title
              <input
                className={fieldClass}
                placeholder="Role title"
                value={requisitionTitle}
                onChange={(e) => setRequisitionTitle(e.target.value)}
                disabled={requisitionLocked || requisitionSaving}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Staff role target
                <input
                  className={fieldClass}
                  placeholder="Staff role target"
                  value={requisitionRoleTarget}
                  onChange={(e) => setRequisitionRoleTarget(e.target.value)}
                  disabled={requisitionLocked || requisitionSaving}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Department
                <input
                  className={fieldClass}
                  placeholder="Department"
                  value={requisitionDepartment}
                  onChange={(e) => setRequisitionDepartment(e.target.value)}
                  disabled={requisitionLocked || requisitionSaving}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              Target hire date
              <input
                type="date"
                className={fieldClass}
                value={requisitionTargetHireDate}
                onChange={(e) => setRequisitionTargetHireDate(e.target.value)}
                disabled={requisitionLocked || requisitionSaving}
              />
            </label>
            <Button
              type="button"
              className="mt-1 w-fit"
              disabled={requisitionSaving || requisitionLocked || !requisitionTitle.trim() || !selectedFacilityId}
              onClick={() =>
                void createStaffRequisition({
                  supabase,
                  userId,
                  selectedFacilityId,
                  requisitionTitle,
                  requisitionRoleTarget,
                  requisitionDepartment,
                  requisitionTargetHireDate,
                  setError,
                  setRequisitionSaving,
                  onSaved: async () => {
                    setRequisitionTitle("");
                    setRequisitionRoleTarget("");
                    setRequisitionDepartment("");
                    setRequisitionTargetHireDate("");
                    await load();
                  },
                })
              }
            >
              {requisitionSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create open position
            </Button>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-foreground">Current requisitions</h4>
              <Badge variant="outline">{requisitionRows.length}</Badge>
            </div>
            {requisitionRows.length === 0 ? (
              <div className="mt-3">
                <AdminEmptyState
                  title={requisitionEmptyTitle}
                  description={requisitionEmptyDescription}
                />
              </div>
            ) : (
              <div className={cn(listShellClass, "mt-3 divide-y divide-border")}>
                {requisitionRows.map((row) => (
                  <div key={row.id} className={cn(listRowClass, "space-y-3")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{row.role_title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.department ?? "No department"} / {row.target_hire_date ?? "No target date"}
                        </div>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {row.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className={cn(fieldClass, "w-auto min-w-40")}
                        value={requisitionStatusDrafts[row.id] ?? row.status}
                        onChange={(e) =>
                          setRequisitionStatusDrafts((current) => ({
                            ...current,
                            [row.id]: e.target.value as RequisitionStatus,
                          }))
                        }
                        disabled={requisitionSaving || requisitionUpdatingId === row.id}
                      >
                        <option value="open">Open</option>
                        <option value="interviewing">Interviewing</option>
                        <option value="offered">Offered</option>
                        <option value="filled">Filled</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          requisitionUpdatingId === row.id ||
                          (requisitionStatusDrafts[row.id] ?? row.status) === row.status
                        }
                        onClick={() =>
                          void updateStaffRequisitionStatus({
                            supabase,
                            userId,
                            requisitionId: row.id,
                            status: requisitionStatusDrafts[row.id] ?? row.status,
                            setError,
                            setRequisitionUpdatingId,
                            onSaved: load,
                          })
                        }
                      >
                        {requisitionUpdatingId === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save status
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2" aria-label="Staffing exceptions">
        <div className={panelClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">Shift assignment gaps</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Review the next 48 hours for unfilled shift coverage.
              </p>
            </div>
            {shiftGaps.length > 0 ? <Badge variant="destructive">Priority dispatch</Badge> : <Badge variant="outline">Clear</Badge>}
          </div>
          {shiftGaps.length === 0 ? (
            <div className="mt-4">
              <AdminEmptyState
                title="No open shift assignment gaps"
                description="Coverage is currently sufficient for the next 48 hours in this scope."
              />
            </div>
          ) : (
            <div className={cn(listShellClass, "mt-4 divide-y divide-border")}>
              {shiftGaps.map((gap) => (
                <div key={gap.id} className={cn(listRowClass, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
                  <div className="flex items-start gap-3">
                    <Clock
                      className={cn("mt-0.5 h-4 w-4", gap.urgency === "critical" ? "text-rose-600" : "text-amber-600")}
                      aria-hidden
                    />
                    <div>
                      <div className="font-medium text-foreground">
                        {gap.date} / {gap.shift}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Short {gap.shortage} {gap.role}
                      </div>
                    </div>
                  </div>
                  <Link href="/admin/schedules" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
                    <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />
                    Review schedule
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={panelClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">Credential warnings</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Expired credentials block assignment until they are cleared.
              </p>
            </div>
            <Link href="/admin/certifications?timeline=expired" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
              Expired certs
            </Link>
          </div>
          {certWarnings.length === 0 ? (
            <div className="mt-4">
              <AdminEmptyState
                title="No credential blockers"
                description="There are no expired credentials in the current staffing scope."
              />
            </div>
          ) : (
            <div className={cn(listShellClass, "mt-4 divide-y divide-border")}>
              {certWarnings.map((cert) => (
                <div key={cert.id} className={cn(listRowClass, "flex flex-col gap-3 bg-rose-50/60 dark:bg-rose-950/20 sm:flex-row sm:items-center sm:justify-between")}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {cert.staffName}
                      <Badge variant="outline">{cert.role}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                      {cert.certName} expired {cert.daysExpired} days ago.
                    </div>
                  </div>
                  <Link href="/admin/certifications?timeline=expired" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
                    Review credential
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className={panelClass} aria-label="Recent ratio snapshots">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {windowFilter === "24h" ? "Recent ratio snapshots (24h)" : "Recent ratio snapshots"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Toggle between compliant and non-compliant snapshots without leaving the console.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {complianceOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setComplianceFilter(option.value)}
                aria-pressed={complianceFilter === option.value}
                className={cn(
                  "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
                  complianceFilter === option.value
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className={cn(listShellClass, "mt-4 divide-y divide-border")}>
          {visibleSnapshots.slice(0, 5).map((snap) => (
            <div key={snap.id} className={cn(listRowClass, "grid gap-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center")}>
              <div className="font-medium text-foreground">
                {new Date(snap.snapshotAt).toLocaleDateString()} / {snap.shift}
              </div>
              <div className="text-muted-foreground">Ratio {snap.ratio.toFixed(1)}</div>
              <Badge variant={snap.isCompliant ? "secondary" : "destructive"}>
                {snap.isCompliant ? "Compliant" : "Non-compliant"}
              </Badge>
            </div>
          ))}
          {visibleSnapshots.length === 0 ? (
            <div className="p-4">
              <AdminEmptyState
                title="No staffing snapshots match this filter"
                description="Broaden the compliance filter or clear the 24 hour window to see additional snapshots."
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

async function createAttendanceEvent(input: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  selectedFacilityId: string | null;
  attendanceStaffId: string;
  attendanceEventType: string;
  attendanceOccurredAt: string;
  attendanceReason: string;
  setError: (value: string | null) => void;
  setAttendanceSaving: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const {
    supabase,
    userId,
    selectedFacilityId,
    attendanceStaffId,
    attendanceEventType,
    attendanceOccurredAt,
    attendanceReason,
    setError,
    setAttendanceSaving,
    onSaved,
  } = input;
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
  setAttendanceSaving(true);
  setError(null);
  try {
    const facilityRes = (await supabase
      .from("facilities" as never)
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle()) as unknown as { data: { organization_id: string } | null; error: QueryError | null };
    if (facilityRes.error || !facilityRes.data?.organization_id) throw new Error("Could not resolve organization.");
    if (!userId) throw new Error("Sign in required.");

    const insertRes = (await supabase
      .from("staff_attendance_events" as never)
      .insert({
        staff_id: attendanceStaffId,
        facility_id: selectedFacilityId,
        organization_id: facilityRes.data.organization_id,
        event_type: attendanceEventType,
        occurred_at: new Date(attendanceOccurredAt).toISOString(),
        reason: attendanceReason.trim() || null,
        created_by: userId,
        updated_by: userId,
      } as never)) as unknown as { error: QueryError | null };
    if (insertRes.error) throw insertRes.error;
    await onSaved();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not create attendance event.");
  } finally {
    setAttendanceSaving(false);
  }
}

async function createStaffRequisition(input: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  selectedFacilityId: string | null;
  requisitionTitle: string;
  requisitionRoleTarget: string;
  requisitionDepartment: string;
  requisitionTargetHireDate: string;
  setError: (value: string | null) => void;
  setRequisitionSaving: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const {
    supabase,
    userId,
    selectedFacilityId,
    requisitionTitle,
    requisitionRoleTarget,
    requisitionDepartment,
    requisitionTargetHireDate,
    setError,
    setRequisitionSaving,
    onSaved,
  } = input;
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
  setRequisitionSaving(true);
  setError(null);
  try {
    const facilityRes = (await supabase
      .from("facilities" as never)
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle()) as unknown as { data: { organization_id: string } | null; error: QueryError | null };
    if (facilityRes.error || !facilityRes.data?.organization_id) throw new Error("Could not resolve organization.");
    if (!userId) throw new Error("Sign in required.");

    const insertRes = (await supabase
      .from("staff_requisitions" as never)
      .insert({
        facility_id: selectedFacilityId,
        organization_id: facilityRes.data.organization_id,
        role_title: requisitionTitle.trim(),
        staff_role_target: requisitionRoleTarget.trim() || null,
        department: requisitionDepartment.trim() || null,
        status: "open",
        target_hire_date: requisitionTargetHireDate || null,
        created_by: userId,
        updated_by: userId,
      } as never)) as unknown as { error: QueryError | null };
    if (insertRes.error) throw insertRes.error;
    await onSaved();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not create requisition.");
  } finally {
    setRequisitionSaving(false);
  }
}

async function updateStaffRequisitionStatus(input: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  requisitionId: string;
  status: RequisitionStatus;
  setError: (value: string | null) => void;
  setRequisitionUpdatingId: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const { supabase, requisitionId, status, userId, setError, setRequisitionUpdatingId, onSaved } = input;
  setRequisitionUpdatingId(requisitionId);
  setError(null);
  try {
    if (!userId) throw new Error("Sign in required.");

    const res = (await supabase
      .from("staff_requisitions" as never)
      .update({
        status,
        updated_by: userId,
      } as never)
      .eq("id", requisitionId)) as unknown as { error: QueryError | null };
    if (res.error) throw res.error;
    await onSaved();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not update requisition.");
  } finally {
    setRequisitionUpdatingId(null);
  }
}
