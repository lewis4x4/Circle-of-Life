"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Users, AlertCircle, Clock, FileWarning, CalendarPlus, Activity, Download, Loader2 } from "lucide-react";

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
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

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
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center p-8 bg-slate-50 dark:bg-slate-900 rounded-2xl">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">System Unavailable</h2>
          <p className="text-sm text-slate-600 mb-4">{error}</p>
          <Button variant="outline" onClick={() => void load()}>Retry Connection</Button>
        </div>
      </div>
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-12">
      <AmbientMatrix hasCriticals={shiftGaps.length > 0 || certWarnings.length > 0} 
        primaryClass="bg-rose-700/10"
        secondaryClass="bg-red-900/10"
        criticalPrimaryClass="bg-red-700/20"
        criticalSecondaryClass="bg-rose-900/10"
      />
      
      <header className="relative z-10 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between shrink-0 pl-1 mb-8">
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 18 / Command</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
            Workforce Command 
            {(shiftGaps.length > 0 || certWarnings.length > 0) && <PulseDot colorClass="bg-rose-500" />}
          </h2>
          <p className="mt-1 text-sm font-mono text-slate-500 dark:text-slate-400">
            Real-time staffing ratio variance, schedule gaps, and compliance warnings.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <Link href="/admin/staff" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs font-medium")}>
              View Roster
            </Link>
            <Link href="/admin/schedules" className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white")}>
              Master Schedule
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs font-medium font-mono uppercase tracking-widest"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportStaffingSnapshotsCsv()}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Snapshots CSV"}
            </Button>
          </div>
          {csvExportError ? (
            <p className="max-w-md text-right text-xs text-rose-600 dark:text-rose-400 font-mono" role="alert">
              {csvExportError}
            </p>
          ) : null}
        </div>
      </header>
      {complianceFilter !== "all" || windowFilter !== "all" ? (
        <div className="relative z-10 flex items-center gap-2 pl-1">
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            {visibleSnapshots.length} visible
          </Badge>
          {complianceFilter !== "all" ? (
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              Compliance filter: {complianceFilter === "non_compliant" ? "non-compliant only" : "compliant only"}
            </Badge>
          ) : null}
          {windowFilter !== "all" ? (
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              Window filter: last 24h
            </Badge>
          ) : null}
          <Link href="/admin/staffing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
            {complianceFilter !== "all" && windowFilter !== "all" ? "Clear staffing filters" : "Clear staffing filter"}
          </Link>
        </div>
      ) : null}

      {/* Exception Metrics (Top Grid) */}
      <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 relative z-10 mb-8" staggerMs={75}>
        {/* Metric 1: Staffing ratio */}
        <div className="h-[160px]">
          <V2Card hoverColor="blue">
            <Sparkline colorClass="text-blue-500" variant={3} />
             <div className="relative z-10 flex flex-col h-full justify-between">
               <span className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 text-slate-500"><Activity className="w-3.5 h-3.5" /> Current Ratio</span>
               <div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className={cn("text-5xl font-mono tracking-tighter pb-1", ratioCardTone)}>
                      {currentRatio != null ? currentRatio.toFixed(1) : "—"}
                    </span>
                    <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">
                      {requiredRatio != null ? `vs ${requiredRatio.toFixed(1)} required` : "No live snapshot"}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-1 text-[10px] uppercase font-mono tracking-widest font-bold",
                      latestVisibleSnapshot == null
                        ? "text-slate-500"
                        : latestVisibleSnapshot.isCompliant
                          ? "text-emerald-500"
                          : "text-amber-500",
                    )}
                  >
                    {ratioStatusCopy}
                  </p>
               </div>
             </div>
          </V2Card>
        </div>

        {/* Metric 2: Unstaffed Next 48h */}
        <div className="h-[160px]">
          <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)] bg-rose-500/5">
             <MonolithicWatermark value={shiftGaps.reduce((sum, g) => sum + g.shortage, 0).toString()} className="text-rose-500/10" />
             <div className="relative z-10 flex flex-col h-full justify-between">
               <span className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 text-rose-500"><Users className="w-3.5 h-3.5" /> Open Shifts (48h)</span>
               <div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="text-5xl font-mono tracking-tighter text-rose-500 pb-1">
                      {shiftGaps.reduce((sum, g) => sum + g.shortage, 0)}
                    </span>
                    <span className="text-xs text-rose-500/70 font-mono uppercase tracking-widest">roles unfilled</span>
                  </div>
                  <p className="mt-1 text-[10px] uppercase font-mono tracking-widest text-rose-500 font-bold">Critical coverage gaps detected in Night shift.</p>
               </div>
             </div>
          </V2Card>
        </div>

        {/* Metric 3: Certifications */}
        <div className="h-[160px]">
          <V2Card href="/admin/certifications?timeline=expired" hoverColor="amber" className="border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)] bg-amber-500/5">
             <MonolithicWatermark value={certWarnings.length.toString()} className="text-amber-500/10" />
             <div className="relative z-10 flex flex-col h-full justify-between">
               <span className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 text-amber-500"><FileWarning className="w-3.5 h-3.5" /> Expired Credentials</span>
               <div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="text-5xl font-mono tracking-tighter text-amber-500 pb-1">
                      {certWarnings.length}
                    </span>
                    <span className="text-xs text-amber-500/70 font-mono uppercase tracking-widest">staff on duty</span>
                  </div>
                  <p className="mt-1 text-[10px] uppercase font-mono tracking-widest text-amber-500 font-bold">1 staff member blocked from assignment due to state registry expiry.</p>
               </div>
             </div>
          </V2Card>
        </div>
      </KineticGrid>

      <div className="grid gap-6 lg:grid-cols-2 relative z-10">
        <div className="glass-panel p-5 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">Log callout / attendance event</h3>
            <Badge className="border-none bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">Drives standup</Badge>
          </div>
          <div className="grid gap-3">
            <select
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
              value={attendanceStaffId}
              onChange={(e) => setAttendanceStaffId(e.target.value)}
            >
              <option value="">Select staff member</option>
              {staffOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
                value={attendanceEventType}
                onChange={(e) => setAttendanceEventType(e.target.value)}
              >
                <option value="callout">Callout</option>
                <option value="late_callout">Late callout</option>
                <option value="no_show">No show</option>
                <option value="left_early">Left early</option>
              </select>
              <input
                type="datetime-local"
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
                value={attendanceOccurredAt}
                onChange={(e) => setAttendanceOccurredAt(e.target.value)}
              />
            </div>
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
              placeholder="Reason / note"
              value={attendanceReason}
              onChange={(e) => setAttendanceReason(e.target.value)}
            />
            <Button
              type="button"
              disabled={attendanceSaving || !attendanceStaffId || !selectedFacilityId}
              onClick={() => void createAttendanceEvent({
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
              })}
            >
              {attendanceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save attendance event
            </Button>
          </div>

          <div className="mt-5 space-y-2">
            <div className="text-xs font-mono uppercase tracking-widest text-slate-500 dark:text-zinc-400">Recent attendance events</div>
            {attendanceRows.length === 0 ? (
              <p className="text-xs font-mono text-slate-500 dark:text-zinc-400">No attendance events recorded yet for this scope.</p>
            ) : (
              attendanceRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-white/10 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-100">
                        {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Staff member"}
                      </div>
                      <div className="text-xs uppercase tracking-widest text-slate-400">
                        {row.event_type.replace(/_/g, " ")}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">{new Date(row.occurred_at).toLocaleString()}</div>
                  </div>
                  {row.reason ? <div className="mt-2 text-xs text-slate-400">{row.reason}</div> : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">Open positions / requisitions</h3>
            <Badge className="border-none bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Drives standup</Badge>
          </div>
          <div className="grid gap-3">
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
              placeholder="Role title"
              value={requisitionTitle}
              onChange={(e) => setRequisitionTitle(e.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
                placeholder="Staff role target"
                value={requisitionRoleTarget}
                onChange={(e) => setRequisitionRoleTarget(e.target.value)}
              />
              <input
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
                placeholder="Department"
                value={requisitionDepartment}
                onChange={(e) => setRequisitionDepartment(e.target.value)}
              />
            </div>
            <input
              type="date"
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100"
              value={requisitionTargetHireDate}
              onChange={(e) => setRequisitionTargetHireDate(e.target.value)}
            />
            <Button
              type="button"
              disabled={requisitionSaving || !requisitionTitle.trim() || !selectedFacilityId}
              onClick={() => void createStaffRequisition({
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
              })}
            >
              {requisitionSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create open position
            </Button>
          </div>

          <div className="mt-5 space-y-2">
            {requisitionRows.length === 0 ? (
              <p className="text-xs font-mono text-slate-500 dark:text-zinc-400">No open requisitions in this scope.</p>
            ) : (
              requisitionRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-white/10 px-3 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-100">{row.role_title}</div>
                      <div className="text-xs text-slate-400">{row.department ?? "No department"} · current status {row.status}</div>
                    </div>
                    <div className="text-xs text-slate-400">{row.target_hire_date ?? "No target date"}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs uppercase tracking-widest text-slate-100"
                      value={requisitionStatusDrafts[row.id] ?? row.status}
                      onChange={(e) => setRequisitionStatusDrafts((current) => ({ ...current, [row.id]: e.target.value as RequisitionStatus }))}
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
                      disabled={requisitionUpdatingId === row.id || (requisitionStatusDrafts[row.id] ?? row.status) === row.status}
                      onClick={() => void updateStaffRequisitionStatus({
                        supabase,
                        requisitionId: row.id,
                        status: requisitionStatusDrafts[row.id] ?? row.status,
                        setError,
                        setRequisitionUpdatingId,
                        onSaved: load,
                      })}
                    >
                      {requisitionUpdatingId === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save status
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 relative z-10">
         {/* Exception UI: Unstaffed Gaps */}
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
               <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">Shift Assignment Gaps</h3>
               <Badge className="font-bold text-[9px] uppercase tracking-widest bg-rose-500/20 text-rose-500 dark:text-rose-400 border-none shadow-sm">Priority Dispatch</Badge>
            </div>
            <MotionList className="space-y-3">
              {shiftGaps.map(gap => (
                 <MotionItem key={gap.id}>
                    <div className="glass-panel p-5 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 relative overflow-hidden group">
                       <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                             <Clock className={cn("w-5 h-5", gap.urgency === "critical" ? "text-rose-500" : "text-amber-500")} />
                             <span className="font-bold font-mono text-xs text-slate-900 dark:text-slate-100 uppercase tracking-widest">{gap.date} · {gap.shift}</span>
                          </div>
                          <Badge variant="outline" className={cn(
                             "h-6 px-2 text-[10px] tracking-widest font-mono font-bold rounded-md border-0 uppercase uppercase",
                             gap.urgency === "critical" ? "bg-rose-500/20 text-rose-800 dark:text-rose-300" : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                          )}>
                             SHORT {gap.shortage} {gap.role}
                          </Badge>
                       </div>
                       <div className="flex gap-2 w-full">
                          <Button size="sm" className="w-full font-mono uppercase tracking-widest text-[9px] font-bold h-9 bg-slate-900/90 dark:bg-white/90 hover:bg-black dark:hover:bg-white text-white dark:text-black">
                             <CalendarPlus className="w-3.5 h-3.5 mr-2" /> Broadcast to PRN
                          </Button>
                          <Button size="sm" variant="outline" className="w-full font-mono uppercase tracking-widest text-[9px] font-bold h-9 bg-white/50 dark:bg-black/50 border-white/20 dark:border-white/5">
                             Mandate Agency
                          </Button>
                       </div>
                    </div>
                 </MotionItem>
              ))}
            </MotionList>
         </div>

         {/* Exception UI: Credential Blocks */}
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
               <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">Credential Warnings (Blockers)</h3>
               <Link href="/admin/certifications?timeline=expired" className="text-[10px] font-mono tracking-widest uppercase font-bold text-indigo-500 hover:text-indigo-400">Expired certs</Link>
            </div>
            
            <MotionList className="space-y-3">
              {certWarnings.map(cert => (
                 <MotionItem key={cert.id}>
                    <div className="glass-panel p-4 rounded-2xl border border-rose-500/30 dark:border-rose-500/20 bg-rose-500/5 relative overflow-hidden group flex items-center justify-between">
                       <div className="flex flex-col gap-1">
                          <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            {cert.staffName} <Badge className="text-[9px] uppercase font-mono bg-white/50 dark:bg-black/50 text-slate-900 dark:text-slate-100 border-none shadow-sm">{cert.role}</Badge>
                          </span>
                          <span className="text-xs font-mono font-semibold tracking-wide text-rose-600 dark:text-rose-400">
                            {cert.certName} expired {cert.daysExpired} days ago
                          </span>
                       </div>
                       <Button size="sm" variant="outline" className="font-mono uppercase tracking-widest text-[9px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20">
                          Remove from Shift
                       </Button>
                    </div>
                 </MotionItem>
              ))}
            </MotionList>
            
            <div className="mt-4 glass-panel p-5 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40">
               <div className="mb-4 flex flex-wrap items-center gap-2">
                 <p className="text-[10px] font-bold font-mono uppercase tracking-widest text-slate-500">
                   {windowFilter === "24h" ? "Recent Ratio Snapshots (24h)" : "Recent Ratio Snapshots (Historical)"}
                 </p>
                 {([
                   { value: "all", label: `All (${windowScopedSnapshots.length})` },
                   { value: "non_compliant", label: `Non-compliant (${windowScopedSnapshots.filter((s) => !s.isCompliant).length})` },
                   { value: "compliant", label: `Compliant (${windowScopedSnapshots.filter((s) => s.isCompliant).length})` },
                 ] as Array<{ value: ComplianceFilter; label: string }>).map((option) => (
                   <button
                     key={option.value}
                     type="button"
                     onClick={() => setComplianceFilter(option.value)}
                     className={cn(
                       "rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors",
                       complianceFilter === option.value
                         ? "bg-indigo-600 text-white"
                         : "bg-white/80 text-slate-600 hover:bg-white dark:bg-black/20 dark:text-zinc-300 dark:hover:bg-black/30",
                     )}
                   >
                     {option.label}
                   </button>
                 ))}
               </div>
               <div className="flex flex-col gap-3">
                 {visibleSnapshots.slice(0, 3).map(snap => (
                    <div key={snap.id} className="flex justify-between items-center text-sm">
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{new Date(snap.snapshotAt).toLocaleDateString()} {snap.shift}</span>
                      <span className={cn("font-mono text-xs font-bold uppercase tracking-widest", snap.isCompliant ? "text-emerald-500" : "text-rose-500")}>
                         {snap.ratio.toFixed(1)} Ratio {snap.isCompliant ? "(OK)" : "(Fail)"}
                      </span>
                    </div>
                 ))}
                 {visibleSnapshots.length === 0 ? (
                   <p className="text-xs font-mono text-slate-500 dark:text-zinc-400">No staffing snapshots match this compliance filter.</p>
                 ) : null}
               </div>
            </div>
         </div>
      </div>

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
