"use client";

import { formatDisplayDate } from "@/lib/format/datetime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Users, Clock, FileWarning, CalendarPlus, Activity, Download, Loader2 } from "lucide-react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import {
  fetchAttendanceEvents,
  fetchCoverageScopeOrNull,
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
import { formatMetric, type MetricState } from "@/lib/metrics/metric-state";
import {
  CERT_REQUIREMENTS_HREF,
  describeCredentialPanel,
  describeShiftGapPanel,
  type StaffingCoverageScope,
} from "@/lib/staffing/staffing-coverage-scope";
import {
  facilityDatetimeLocalToUtcIso,
  formatFacilityTimestampEt,
  nowFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";
import {
  formatStaffingConsoleCurrentRatioMainValue,
  staffingConsoleCurrentRatioMainIsNumeric,
} from "@/lib/staffing/staffing-console-display-copy";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";
import { NamedAdminRouteLoading } from "@/components/layout/named-admin-route-loading";
import { ADMIN_STAFFING_ROUTE_LOADING_MESSAGE } from "@/lib/admin/named-admin-route-loading-copy";
import { AdminEmptyState, AdminErrorState } from "@/components/common/admin-list-patterns";
import { enumLabel } from "@/lib/display/enum-label";
import { useLatestLoad } from "@/hooks/useLatestLoad";
import { STAFFING_RATIO_CHECK_OFF_COPY, fetchStaffingRatioCheckOn } from "@/lib/staffing/ratio-check";

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
    "required_ratio (reference only)",
    "is_compliant (reference only)",
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
  /** Omitted/null = unknown: panels say "could not be checked", never "Clear". */
  initialCoverageScope?: StaffingCoverageScope | null;
  /** The facility's staffing-ratio check (ratio rule set assigned). Off unless known on. */
  initialRatioCheckOn?: boolean;
  initialError: string | null;
  initialFacilityId: string | null;
};

/** Tile value: large number for a figure, muted phrase for any other state (COL-649). */
function metricTileValueClass(state: MetricState<number>): string {
  return state.status === "value"
    ? "text-3xl font-semibold tabular-nums text-foreground"
    : "text-lg font-semibold leading-snug text-muted-foreground";
}

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
  initialCoverageScope = null,
  initialRatioCheckOn = false,
  initialError,
  initialFacilityId,
}: AdminStaffingConsolePageClientProps) {
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>(initialSnapshots);
  const [certWarnings, setCertWarnings] = useState<CertWarning[]>(initialCertWarnings);
  const [shiftGaps, setShiftGaps] = useState<ShiftGap[]>(initialShiftGaps);
  const [coverageScope, setCoverageScope] = useState<StaffingCoverageScope | null>(initialCoverageScope);
  const [ratioCheckOn, setRatioCheckOn] = useState(initialRatioCheckOn);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [csvExportError, setCsvExportError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>(initialStaffOptions);
  const [requisitionRows, setRequisitionRows] = useState<RequisitionRow[]>(initialRequisitions);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceEventRow[]>(initialAttendance);
  const [attendanceStaffId, setAttendanceStaffId] = useState("");
  const [attendanceEventType, setAttendanceEventType] = useState("callout");
  const [attendanceOccurredAt, setAttendanceOccurredAt] = useState(() => nowFacilityDatetimeLocal());
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
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");

  // Skip the first client-side load when the server already supplied data for
  // the current facility. Facility scope changes still refetch client-side.
  const skipNextLoadRef = useRef(initialError == null);
  const beginLoad = useLatestLoad();

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;
    const isCurrent = beginLoad();

    setIsLoading(true);
    setError(null);
    try {
      const [
        liveSnapshots,
        liveCertWarnings,
        liveShiftGaps,
        liveStaffOptions,
        liveRequisitions,
        liveAttendance,
        liveCoverageScope,
        liveRatioCheckOn,
      ] = await Promise.all([
        fetchSnapshotsFromSupabase(selectedFacilityId),
        fetchExpiredCertificationWarnings(selectedFacilityId),
        fetchShiftAssignmentGaps(selectedFacilityId),
        fetchStaffOptions(selectedFacilityId),
        fetchStaffRequisitions(selectedFacilityId),
        fetchAttendanceEvents(selectedFacilityId),
        fetchCoverageScopeOrNull(selectedFacilityId),
        fetchStaffingRatioCheckOn(selectedFacilityId),
      ]);
      if (!isCurrent()) return;
      setSnapshots(liveSnapshots);
      setCertWarnings(liveCertWarnings);
      setShiftGaps(liveShiftGaps);
      setStaffOptions(liveStaffOptions);
      setRequisitionRows(liveRequisitions);
      setAttendanceRows(liveAttendance);
      setCoverageScope(liveCoverageScope);
      setRatioCheckOn(liveRatioCheckOn);
      setRequisitionStatusDrafts(
        Object.fromEntries(liveRequisitions.map((row) => [row.id, row.status])),
      );
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to load staffing metrics");
      setCertWarnings([]);
      setShiftGaps([]);
      setCoverageScope(null);
      setStaffOptions([]);
      setRequisitionRows([]);
      setAttendanceRows([]);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [beginLoad, selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requestedWindow = searchParams.get("window");
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

  // COL-675: pass/fail shows only while the facility's staffing-ratio check is on (a ratio
  // rule set is assigned). Brian turned it off, so by default nothing here says compliant.
  const visibleSnapshots = windowScopedSnapshots;

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
    return <NamedAdminRouteLoading message={ADMIN_STAFFING_ROUTE_LOADING_MESSAGE} />;
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
  const currentRatioMainValue = formatStaffingConsoleCurrentRatioMainValue(currentRatio);
  const currentRatioMainIsNumeric = staffingConsoleCurrentRatioMainIsNumeric(currentRatioMainValue);
  const requiredRatio = ratioCheckOn ? latestVisibleSnapshot?.requiredRatio ?? null : null;
  const ratioDelta = currentRatio != null && requiredRatio != null ? currentRatio - requiredRatio : null;
  const ratioCardTone =
    !ratioCheckOn || latestVisibleSnapshot == null
      ? "text-foreground"
      : latestVisibleSnapshot.isCompliant
        ? "text-success"
        : "text-warning";
  const ratioStatusCopy = !ratioCheckOn
    ? STAFFING_RATIO_CHECK_OFF_COPY
    : latestVisibleSnapshot == null
      ? "No staffing snapshot has been recorded for this view."
      : ratioDelta != null && ratioDelta > 0
        ? `${ratioDelta.toFixed(1)} above the required ratio on the latest ${enumLabel(latestVisibleSnapshot.shift, { case: "lower" })} snapshot.`
        : ratioDelta != null
          ? `${Math.abs(ratioDelta).toFixed(1)} at or below the required ratio on the latest ${enumLabel(latestVisibleSnapshot.shift, { case: "lower" })} snapshot.`
          : "Latest staffing snapshot loaded for this view.";
  const openShiftShortage = shiftGaps.reduce((sum, gap) => sum + gap.shortage, 0);
  const shiftPanel = describeShiftGapPanel({
    scope: coverageScope,
    openShiftShortage,
    gapRows: shiftGaps.length,
  });
  const credentialPanel = describeCredentialPanel(coverageScope);
  const adpStaffBlocker =
    selectedFacilityId != null && staffOptions.length === 0
        ? "No active staff came back from the ADP-linked directory for this facility. Attendance logging is blocked until the feed syncs."
        : null;
  // Single pass over the snapshots (this runs after an early return, so it
  // can't be a hook); derive both counts from one filter instead of two.

  const attendanceLocked = adpStaffBlocker != null;
  const attendanceEmptyTitle = attendanceLocked ? "Attendance logging blocked" : "No attendance events yet";
  const attendanceEmptyDescription = attendanceLocked
    ? "Once the active staff directory syncs, attendance events will appear here."
    : "Attendance logging will appear here once staff callouts or late arrivals are recorded for this scope.";
  const requisitionEmptyTitle = "No open requisitions";
  const requisitionEmptyDescription = "Create a requisition when a shift opens up or a role needs to be backfilled.";

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Workforce command</Badge>
            {selectedFacilityId ? (
              <Badge variant="secondary">Facility scoped</Badge>
            ) : (
              <Badge variant="outline">All facilities</Badge>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Staffing alerts
            </h1>
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

      {windowFilter !== "all" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{visibleSnapshots.length} visible snapshots</Badge>
          <Badge variant="outline">Last 24 hours</Badge>
          <Link href="/admin/staffing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2")}>
            Clear filters
          </Link>
        </div>
      ) : null}


      <section className="grid gap-4 md:grid-cols-3" aria-label="Workforce status">
        <div className={panelClass}>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" aria-hidden />
            Current ratio
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span
              className={cn(
                currentRatioMainIsNumeric
                  ? "text-3xl font-semibold tabular-nums"
                  : "text-lg font-semibold leading-snug",
                ratioCardTone,
              )}
            >
              {currentRatioMainIsNumeric
                ? currentRatioMainValue.toFixed(1)
                : currentRatioMainValue}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">
              {latestVisibleSnapshot == null
                ? "no live snapshot"
                : requiredRatio != null
                  ? `required ${requiredRatio.toFixed(1)}`
                  : "residents per staff"}
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
                metricTileValueClass(shiftPanel.tile),
                openShiftShortage > 0 ? "text-rose-600 dark:text-rose-400" : "",
              )}
            >
              {formatMetric(shiftPanel.tile)}
            </span>
            {shiftPanel.tile.status === "value" ? (
              <span className="pb-1 text-sm text-muted-foreground">roles unfilled</span>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{shiftPanel.tileCopy}</p>
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
                metricTileValueClass(credentialPanel.tile),
                certWarnings.length > 0 ? "text-amber-700 dark:text-amber-400" : "",
              )}
            >
              {formatMetric(credentialPanel.tile)}
            </span>
            {credentialPanel.tile.status === "value" ? (
              <span className="pb-1 text-sm text-muted-foreground">blockers</span>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{credentialPanel.tileCopy}</p>
        </Link>
      </section>

      {selectedFacilityId ? (
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
                  Occurred at (ET)
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
                            {enumLabel(row.event_type)}
                          </Badge>
                          <span>{formatFacilityTimestampEt(row.occurred_at)} ET</span>
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


            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5 text-sm font-medium">
                Role title
                <input
                  className={fieldClass}
                  placeholder="Role title"
                  value={requisitionTitle}
                  onChange={(e) => setRequisitionTitle(e.target.value)}
                  disabled={requisitionSaving}
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
                    disabled={requisitionSaving}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Department
                  <input
                    className={fieldClass}
                    placeholder="Department"
                    value={requisitionDepartment}
                    onChange={(e) => setRequisitionDepartment(e.target.value)}
                    disabled={requisitionSaving}
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                Target hire date (ET)
                <input
                  type="date"
                  className={fieldClass}
                  value={requisitionTargetHireDate}
                  onChange={(e) => setRequisitionTargetHireDate(e.target.value)}
                  disabled={requisitionSaving}
                  aria-label="Target hire date (Eastern Time)"
                />
              </label>
              <Button
                type="button"
                className="mt-1 w-fit"
                disabled={requisitionSaving || !requisitionTitle.trim() || !selectedFacilityId}
                onClick={() =>
                  void createStaffRequisition({
                    supabase,
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
      ) : (
        <FacilityGateNotice reason="Attendance events and open positions are recorded for one building. The staffing figures above cover all of your facilities." />
      )}

      <section className="grid gap-6 xl:grid-cols-2" aria-label="Staffing exceptions">
        <div className={panelClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">Shift assignment gaps</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Review the next 48 hours for unfilled shift coverage.
              </p>
            </div>
            <Badge variant={shiftPanel.badge === "gaps" ? "destructive" : "outline"}>{shiftPanel.badgeLabel}</Badge>
          </div>
          {shiftGaps.length === 0 ? (
            <div className="mt-4">
              <AdminEmptyState
                title={shiftPanel.emptyTitle}
                description={shiftPanel.emptyDescription}
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
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href={CERT_REQUIREMENTS_HREF} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                Requirements
              </Link>
              <Link href="/admin/certifications?timeline=expired" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Expired certs
              </Link>
            </div>
          </div>
          {certWarnings.length === 0 ? (
            <div className="mt-4">
              <AdminEmptyState
                title={credentialPanel.emptyTitle}
                description={credentialPanel.emptyDescription}
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
              {ratioCheckOn ? "Each snapshot against the facility's staffing ratio rule." : STAFFING_RATIO_CHECK_OFF_COPY}
            </p>
          </div>
        </div>
        <div className={cn(listShellClass, "mt-4 divide-y divide-border")}>
          {visibleSnapshots.slice(0, 5).map((snap) => (
            <div key={snap.id} className={cn(listRowClass, "grid gap-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center")}>
              <div className="font-medium text-foreground">
                {formatDisplayDate(snap.snapshotAt)} / {snap.shift}
              </div>
              <div className="text-muted-foreground">
                Ratio {snap.ratio.toFixed(1)}
                {ratioCheckOn ? (
                  <Badge className="ml-2" variant={snap.isCompliant ? "secondary" : "destructive"}>
                    {snap.isCompliant ? "Within ratio" : "Over ratio"}
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
          {visibleSnapshots.length === 0 ? (
            <div className="p-4">
              <AdminEmptyState
                title="No staffing snapshots match this filter"
                description="Clear the 24 hour window to see earlier snapshots."
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
    const result = await supabase.rpc("haven_employee_file_command" as never, {
      p_staff_id: attendanceStaffId,
      p_action: "record_attendance",
      p_payload: {
        event_type: attendanceEventType,
        occurred_at: facilityDatetimeLocalToUtcIso(attendanceOccurredAt),
        reason: attendanceReason.trim() || null,
      },
    } as never);
    if (result.error) throw new Error(result.error.message);
    await onSaved();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not create attendance event.");
  } finally {
    setAttendanceSaving(false);
  }
}

async function createStaffRequisition(input: {
  supabase: ReturnType<typeof createClient>;
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
    const authRes = await supabase.auth.getUser();
    const userId = authRes.data.user?.id;
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
  requisitionId: string;
  status: RequisitionStatus;
  setError: (value: string | null) => void;
  setRequisitionUpdatingId: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const { supabase, requisitionId, status, setError, setRequisitionUpdatingId, onSaved } = input;
  setRequisitionUpdatingId(requisitionId);
  setError(null);
  try {
    const authRes = await supabase.auth.getUser();
    const userId = authRes.data.user?.id;
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
