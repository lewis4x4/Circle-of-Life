"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { GraduationCap } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { parseCompetencyAttachments } from "@/lib/training/competency-storage";
import { CompetencyCertificateOpenButton } from "@/components/training/competency-certificate-open-button";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type DemoRow = Database["public"]["Tables"]["competency_demonstrations"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
  facilities: { name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

/** Demonstrations that still need staff or evaluator action (Core workflow). */
function needsAttentionStatus(status: DemoRow["status"]): boolean {
  return status === "draft" || status === "submitted" || status === "failed";
}

function attentionLabel(status: DemoRow["status"]): { title: string; tone: "amber" | "rose" | "slate" } {
  if (status === "failed") return { title: "Failed — follow-up required", tone: "rose" };
  if (status === "submitted") return { title: "Awaiting evaluator sign-off", tone: "amber" };
  return { title: "Draft — complete evaluation", tone: "slate" };
}

function buildCompetencyDemonstrationsCsv(rows: DemoRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "facility_name",
    "staff_first_name",
    "staff_last_name",
    "status",
    "demonstrated_at",
    "notes",
    "attachment_storage_paths",
  ].join(",");
  const body = rows.map((row) => {
    const paths = parseCompetencyAttachments(row.attachments)
      .map((a) => a.storage_path)
      .join(" | ");
    return [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.facilities?.name ?? ""),
      csvEscapeCell(row.staff?.first_name ?? ""),
      csvEscapeCell(row.staff?.last_name ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.demonstrated_at),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(paths),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

type CompletionRow = Database["public"]["Tables"]["staff_training_completions"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
  facilities: { name: string } | null;
  training_programs: { code: string; name: string } | null;
};

function formatHours(h: number | null | undefined): string {
  if (h == null) return "—";
  const n = typeof h === "number" ? h : Number(h);
  if (Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function buildStaffTrainingCompletionsCsv(rows: CompletionRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "facility_name",
    "staff_first_name",
    "staff_last_name",
    "training_program_code",
    "training_program_name",
    "completed_at",
    "expires_at",
    "hours_completed",
    "delivery_method",
    "external_provider",
    "certificate_number",
    "notes",
    "attachment_path",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.facilities?.name ?? ""),
      csvEscapeCell(row.staff?.first_name ?? ""),
      csvEscapeCell(row.staff?.last_name ?? ""),
      csvEscapeCell(row.training_programs?.code ?? ""),
      csvEscapeCell(row.training_programs?.name ?? ""),
      csvEscapeCell(row.completed_at),
      csvEscapeCell(row.expires_at ?? ""),
      csvEscapeCell(row.hours_completed != null ? String(row.hours_completed) : ""),
      csvEscapeCell(row.delivery_method),
      csvEscapeCell(row.external_provider ?? ""),
      csvEscapeCell(row.certificate_number ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.attachment_path ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

type InserviceRow = Database["public"]["Tables"]["inservice_log_sessions"]["Row"] & {
  facilities: { name: string } | null;
  training_programs: { code: string; name: string } | null;
  inservice_log_attendees: { id: string }[] | null;
};

function buildInserviceSessionsCsv(rows: InserviceRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "facility_name",
    "session_date",
    "topic",
    "trainer_name",
    "hours",
    "training_program_code",
    "training_program_name",
    "attendee_count",
    "location",
    "notes",
  ].join(",");
  const body = rows.map((row) => {
    const n = (row.inservice_log_attendees ?? []).length;
    return [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.facilities?.name ?? ""),
      csvEscapeCell(row.session_date),
      csvEscapeCell(row.topic),
      csvEscapeCell(row.trainer_name),
      csvEscapeCell(String(row.hours)),
      csvEscapeCell(row.training_programs?.code ?? ""),
      csvEscapeCell(row.training_programs?.name ?? ""),
      csvEscapeCell(String(n)),
      csvEscapeCell(row.location ?? ""),
      csvEscapeCell(row.notes ?? ""),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

export default function AdminTrainingHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DemoRow[]>([]);
  const [completionRows, setCompletionRows] = useState<CompletionRow[]>([]);
  const [inserviceRows, setInserviceRows] = useState<InserviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCompletions, setLoadingCompletions] = useState(true);
  const [loadingInservice, setLoadingInservice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [inserviceError, setInserviceError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingCompletionsCsv, setExportingCompletionsCsv] = useState(false);
  const [exportingInserviceCsv, setExportingInserviceCsv] = useState(false);

  /** `null` = All facilities (RLS scopes rows to accessible facilities). */
  const orgWideMode = selectedFacilityId === null;
  const singleFacilityMode =
    Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const facilityReady = orgWideMode || singleFacilityMode;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadingCompletions(true);
    setLoadingInservice(true);
    setError(null);
    setCompletionError(null);
    setInserviceError(null);
    if (!facilityReady) {
      setRows([]);
      setCompletionRows([]);
      setInserviceRows([]);
      setLoading(false);
      setLoadingCompletions(false);
      setLoadingInservice(false);
      return;
    }
    try {
      let q = supabase
        .from("competency_demonstrations")
        .select("*, staff(first_name, last_name), facilities(name)")
        .is("deleted_at", null)
        .order("demonstrated_at", { ascending: false })
        .limit(50);
      if (singleFacilityMode && selectedFacilityId) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setRows((data ?? []) as DemoRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competency demonstrations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
    try {
      let cq = supabase
        .from("staff_training_completions")
        .select(
          "*, staff(first_name, last_name), facilities(name), training_programs(code, name)",
        )
        .is("deleted_at", null)
        .order("completed_at", { ascending: false })
        .limit(50);
      if (singleFacilityMode && selectedFacilityId) {
        cq = cq.eq("facility_id", selectedFacilityId);
      }
      const { data: cData, error: cErr } = await cq;
      if (cErr) throw cErr;
      setCompletionRows((cData ?? []) as CompletionRow[]);
    } catch (e) {
      setCompletionError(
        e instanceof Error ? e.message : "Failed to load staff training completions.",
      );
      setCompletionRows([]);
    } finally {
      setLoadingCompletions(false);
    }
    try {
      let iq = supabase
        .from("inservice_log_sessions")
        .select(
          "*, facilities(name), training_programs(code, name), inservice_log_attendees(id)",
        )
        .is("deleted_at", null)
        .order("session_date", { ascending: false })
        .limit(50);
      if (singleFacilityMode && selectedFacilityId) {
        iq = iq.eq("facility_id", selectedFacilityId);
      }
      const { data: iData, error: iErr } = await iq;
      if (iErr) throw iErr;
      setInserviceRows((iData ?? []) as InserviceRow[]);
    } catch (e) {
      setInserviceError(
        e instanceof Error ? e.message : "Failed to load in-service sessions.",
      );
      setInserviceRows([]);
    } finally {
      setLoadingInservice(false);
    }
  }, [supabase, selectedFacilityId, facilityReady, singleFacilityMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const attentionRows = useMemo(
    () =>
      rows
        .filter((r) => needsAttentionStatus(r.status))
        .sort(
          (a, b) =>
            new Date(a.demonstrated_at).getTime() - new Date(b.demonstrated_at).getTime(),
        ),
    [rows],
  );

  const statusCounts = useMemo(() => {
    let passed = 0;
    let pending = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.status === "passed") passed++;
      else if (r.status === "failed") failed++;
      else if (r.status === "submitted" || r.status === "draft") pending++;
    }
    return { passed, pending, failed, total: rows.length };
  }, [rows]);

  const recentPassedRows = useMemo(
    () =>
      rows
        .filter((r) => r.status === "passed")
        .sort(
          (a, b) =>
            new Date(b.demonstrated_at).getTime() - new Date(a.demonstrated_at).getTime(),
        )
        .slice(0, 5),
    [rows],
  );

  const exportDemonstrationsCsv = useCallback(async () => {
    if (!facilityReady) return;
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("competency_demonstrations")
        .select("*, staff(first_name, last_name), facilities(name)")
        .is("deleted_at", null)
        .order("demonstrated_at", { ascending: false })
        .limit(500);
      if (singleFacilityMode && selectedFacilityId) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      const exportRows = (data ?? []) as DemoRow[];
      const csv = buildCompetencyDemonstrationsCsv(exportRows);
      const scope = orgWideMode ? "all-facilities" : selectedFacilityId ?? "facility";
      triggerCsvDownload(
        `competency-demonstrations_${scope}_${format(new Date(), "yyyy-MM-dd")}.csv`,
        csv,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [
    facilityReady,
    orgWideMode,
    selectedFacilityId,
    singleFacilityMode,
    supabase,
  ]);

  const exportCompletionsCsv = useCallback(async () => {
    if (!facilityReady) return;
    setExportingCompletionsCsv(true);
    setCompletionError(null);
    try {
      let q = supabase
        .from("staff_training_completions")
        .select(
          "*, staff(first_name, last_name), facilities(name), training_programs(code, name)",
        )
        .is("deleted_at", null)
        .order("completed_at", { ascending: false })
        .limit(500);
      if (singleFacilityMode && selectedFacilityId) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      const exportRows = (data ?? []) as CompletionRow[];
      const csv = buildStaffTrainingCompletionsCsv(exportRows);
      const scope = orgWideMode ? "all-facilities" : selectedFacilityId ?? "facility";
      triggerCsvDownload(
        `staff-training-completions_${scope}_${format(new Date(), "yyyy-MM-dd")}.csv`,
        csv,
      );
    } catch (e) {
      setCompletionError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCompletionsCsv(false);
    }
  }, [
    facilityReady,
    orgWideMode,
    selectedFacilityId,
    singleFacilityMode,
    supabase,
  ]);

  const exportInserviceCsv = useCallback(async () => {
    if (!facilityReady) return;
    setExportingInserviceCsv(true);
    setInserviceError(null);
    try {
      let q = supabase
        .from("inservice_log_sessions")
        .select(
          "*, facilities(name), training_programs(code, name), inservice_log_attendees(id)",
        )
        .is("deleted_at", null)
        .order("session_date", { ascending: false })
        .limit(500);
      if (singleFacilityMode && selectedFacilityId) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      const exportRows = (data ?? []) as InserviceRow[];
      const csv = buildInserviceSessionsCsv(exportRows);
      const scope = orgWideMode ? "all-facilities" : selectedFacilityId ?? "facility";
      triggerCsvDownload(
        `inservice-sessions_${scope}_${format(new Date(), "yyyy-MM-dd")}.csv`,
        csv,
      );
    } catch (e) {
      setInserviceError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingInserviceCsv(false);
    }
  }, [
    facilityReady,
    orgWideMode,
    selectedFacilityId,
    singleFacilityMode,
    supabase,
  ]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">
              SYS: Module 12 / Training and Competency
            </p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Training & Competency
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={rows.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5" /> Demos Completed
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{rows.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">
                   {orgWideMode
                     ? "Last 50 competency demonstrations across your accessible facilities (ordered by date). RLS enforces scope."
                     : "Documented skills demonstrations for the selected facility."}
                 </p>
                 <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:justify-end lg:items-end">
                   <Button
                     type="button"
                     variant="outline"
                     disabled={!facilityReady || exportingCsv}
                     className="font-mono uppercase tracking-widest text-[10px]"
                     onClick={() => void exportDemonstrationsCsv()}
                   >
                     {exportingCsv ? "Preparing…" : "Download demonstrations CSV"}
                   </Button>
                   {orgWideMode ? (
                     <Button
                       type="button"
                       disabled
                       className="font-mono uppercase tracking-widest text-[10px] opacity-70"
                       title="Select a single facility in the header to record a new demonstration."
                     >
                       + New Demonstration
                     </Button>
                   ) : (
                     <Link
                       href="/admin/training/new"
                       className={cn(
                         buttonVariants({ size: "default" }),
                         "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none",
                       )}
                     >
                       + New Demonstration
                     </Link>
                   )}
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

        {facilityReady && (
          <>
          <div className="space-y-4 border-t border-white/10 pt-8 dark:border-white/5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Staff training completions
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  Last 50 completion records per facility scope (RLS). Log new completions for a single
                  facility; export supports audits.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {orgWideMode ? (
                  <Button
                    type="button"
                    disabled
                    className="shrink-0 font-mono uppercase tracking-widest text-[10px] opacity-70"
                    title="Select a single facility in the header to log a completion."
                  >
                    + Log completion
                  </Button>
                ) : (
                  <Link
                    href="/admin/training/completions/new"
                    className={cn(
                      buttonVariants({ size: "default" }),
                      "shrink-0 font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none",
                    )}
                  >
                    + Log completion
                  </Link>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!facilityReady || exportingCompletionsCsv}
                  className="shrink-0 font-mono uppercase tracking-widest text-[10px]"
                  onClick={() => void exportCompletionsCsv()}
                >
                  {exportingCompletionsCsv ? "Preparing…" : "Download completions CSV"}
                </Button>
              </div>
            </div>
            {completionError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                {completionError}
              </p>
            )}
            {loadingCompletions ? (
              <p className="text-sm font-mono text-slate-500">Loading completions…</p>
            ) : completionRows.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/30 p-8 text-center text-slate-500 dark:border-white/5 dark:bg-slate-900/30">
                <p className="font-medium text-slate-700 dark:text-slate-300">No completion rows yet</p>
                <p className="mt-1 text-sm opacity-80">
                  Florida catalog programs are seeded. Select a facility and use{" "}
                  <span className="font-mono">+ Log completion</span> to add a row.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/20 bg-white/40 dark:border-white/5 dark:bg-slate-900/40">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/20 font-mono uppercase tracking-wider text-slate-500 dark:border-white/10">
                      <th className="px-3 py-2">Facility</th>
                      <th className="px-3 py-2">Staff</th>
                      <th className="px-3 py-2">Program</th>
                      <th className="px-3 py-2">Completed</th>
                      <th className="px-3 py-2">Expires</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2">Delivery</th>
                      <th className="px-3 py-2">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completionRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-white/10 text-slate-800 last:border-0 dark:border-white/5 dark:text-slate-200"
                      >
                        <td className="px-3 py-2 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
                          {row.facilities?.name ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {row.staff
                            ? `${row.staff.first_name} ${row.staff.last_name}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.training_programs?.name ?? "—"}</span>
                          {row.training_programs?.code ? (
                            <span className="ml-1 text-[10px] text-slate-500">
                              ({row.training_programs.code})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px]">
                          {row.completed_at
                            ? format(new Date(`${row.completed_at}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px]">
                          {row.expires_at
                            ? format(new Date(`${row.expires_at}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono">{formatHours(row.hours_completed)}</td>
                        <td className="px-3 py-2 capitalize text-slate-600 dark:text-slate-400">
                          {formatStatus(row.delivery_method)}
                        </td>
                        <td className="px-3 py-2">
                          {row.attachment_path ? (
                            <CompetencyCertificateOpenButton
                              storagePath={row.attachment_path}
                              label="Open PDF"
                              className="h-7 text-[9px] px-2"
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-4 border-t border-white/10 pt-8 dark:border-white/5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  In-service sessions
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  Last 50 in-service events (RLS). Create a session for one facility at a time; export for
                  audits.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {orgWideMode ? (
                  <Button
                    type="button"
                    disabled
                    className="shrink-0 font-mono uppercase tracking-widest text-[10px] opacity-70"
                    title="Select a single facility in the header to record a new in-service session."
                  >
                    + New in-service session
                  </Button>
                ) : (
                  <Link
                    href="/admin/training/inservice/new"
                    className={cn(
                      buttonVariants({ size: "default" }),
                      "shrink-0 font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none",
                    )}
                  >
                    + New in-service session
                  </Link>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!facilityReady || exportingInserviceCsv}
                  className="shrink-0 font-mono uppercase tracking-widest text-[10px]"
                  onClick={() => void exportInserviceCsv()}
                >
                  {exportingInserviceCsv ? "Preparing…" : "Download in-service CSV"}
                </Button>
              </div>
            </div>
            {inserviceError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                {inserviceError}
              </p>
            )}
            {loadingInservice ? (
              <p className="text-sm font-mono text-slate-500">Loading in-service sessions…</p>
            ) : inserviceRows.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/30 p-8 text-center text-slate-500 dark:border-white/5 dark:bg-slate-900/30">
                <p className="font-medium text-slate-700 dark:text-slate-300">No in-service sessions yet</p>
                <p className="mt-1 text-sm opacity-80">
                  Select a facility and use <span className="font-mono">+ New in-service session</span> to log
                  attendance.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/20 bg-white/40 dark:border-white/5 dark:bg-slate-900/40">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/20 font-mono uppercase tracking-wider text-slate-500 dark:border-white/10">
                      <th className="px-3 py-2">Facility</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Topic</th>
                      <th className="px-3 py-2">Trainer</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2">Program</th>
                      <th className="px-3 py-2">Attendees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inserviceRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-white/10 text-slate-800 last:border-0 dark:border-white/5 dark:text-slate-200"
                      >
                        <td className="px-3 py-2 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
                          {row.facilities?.name ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px]">
                          {row.session_date
                            ? format(new Date(`${row.session_date}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-3 py-2 max-w-[200px] truncate" title={row.topic}>
                          {row.topic}
                        </td>
                        <td className="px-3 py-2">{row.trainer_name}</td>
                        <td className="px-3 py-2 font-mono">{formatHours(Number(row.hours))}</td>
                        <td className="px-3 py-2">
                          {row.training_programs?.name ? (
                            <span className="font-medium">{row.training_programs.name}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {(row.inservice_log_attendees ?? []).length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
        )}

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Facility selection is invalid. Choose a facility or &quot;All facilities&quot; in the header.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ACTION QUEUE: Pending Evaluations / Overdue Skills */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Pending Evaluations & Overdue Skills
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading…</p>
              ) : (
                <>
                  {attentionRows.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md">
                      <p className="font-medium">No open demonstrations</p>
                      <p className="text-sm opacity-80 mt-1">
                        Nothing in draft, submitted, or failed status in the loaded batch (last 50 records
                        {orgWideMode ? " across accessible facilities" : " for this facility"}).
                      </p>
                    </div>
                  ) : (
                    attentionRows.map((row) => {
                    const attachmentItems = parseCompetencyAttachments(row.attachments);
                    const { title, tone } = attentionLabel(row.status);
                    const bar =
                      tone === "rose"
                        ? "bg-rose-500"
                        : tone === "amber"
                          ? "bg-amber-500"
                          : "bg-slate-400";
                    const border =
                      tone === "rose"
                        ? "border-rose-200 dark:border-rose-900/30 hover:border-rose-300 dark:hover:border-rose-800/50"
                        : tone === "amber"
                          ? "border-amber-200 dark:border-amber-900/30 hover:border-amber-300 dark:hover:border-amber-800/50"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300";
                    const badge =
                      tone === "rose"
                        ? "text-rose-600 dark:text-rose-400 bg-rose-500/20"
                        : tone === "amber"
                          ? "text-amber-600 dark:text-amber-400 bg-amber-500/20"
                          : "text-slate-800 dark:text-slate-300 bg-slate-200/50 dark:bg-slate-800/50";
                    const btn =
                      tone === "rose"
                        ? "bg-rose-600 text-white hover:bg-rose-500 hover:text-white"
                        : tone === "amber"
                          ? "bg-amber-500 text-black hover:bg-amber-400 hover:text-black"
                          : "bg-slate-900 dark:bg-white text-white dark:text-black hover:bg-black dark:hover:bg-slate-200";
                    return (
                      <MotionItem
                        key={row.id}
                        className={cn(
                          "glass-panel p-5 rounded-2xl border bg-white/40 dark:bg-slate-900/40 relative overflow-hidden group transition-all duration-300 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer",
                          border,
                        )}
                      >
                        <div className={cn("absolute top-0 left-0 w-1 h-full", bar)} />
                        <div className="flex justify-between items-start mb-4">
                          <span
                            className={cn(
                              "text-[9px] font-mono font-bold shadow-sm px-2 py-1 rounded-md uppercase tracking-widest",
                              badge,
                            )}
                          >
                            {title}
                          </span>
                          <span className="flex flex-col items-end gap-1 text-right sm:flex-row sm:items-center sm:gap-2">
                            {orgWideMode && row.facilities?.name ? (
                              <span className="text-[9px] uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-mono font-bold bg-indigo-500/10 px-2 py-0.5 rounded">
                                {row.facilities.name}
                              </span>
                            ) : null}
                            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-bold bg-white/50 dark:bg-black/30 px-2 py-0.5 rounded shadow-sm">
                              Session {format(new Date(row.demonstrated_at), "MMM d, yyyy")}
                            </span>
                          </span>
                        </div>
                        <div className="mb-4">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                            {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Staff"} —{" "}
                            {formatStatus(row.status)}
                          </p>
                          {row.notes ? (
                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3">{row.notes}</p>
                          ) : (
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              Demonstration record — open or complete evaluation.
                            </p>
                          )}
                          {attachmentItems.length > 0 ? (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {attachmentItems.map((a) => (
                                <CompetencyCertificateOpenButton
                                  key={a.storage_path}
                                  storagePath={a.storage_path}
                                  label={a.label}
                                  className="h-8 text-[10px] font-mono uppercase tracking-widest"
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex justify-start">
                          <Link
                            href="/admin/training/new"
                            className={cn(
                              buttonVariants({ variant: "default", size: "sm" }),
                              "text-white font-mono uppercase tracking-widest text-[10px]",
                              btn,
                            )}
                          >
                            Open workflow
                          </Link>
                        </div>
                      </MotionItem>
                    );
                  })
                  )}

                  {recentPassedRows.length > 0 && (
                    <MotionList className="mt-8 space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                        Recently passed
                      </h4>
                      {recentPassedRows.map((row) => {
                        const passedAttachments = parseCompetencyAttachments(row.attachments);
                        return (
                        <MotionItem
                          key={row.id}
                          className="glass-panel p-3 rounded-xl border border-white/20 dark:border-white/5 bg-white/30 dark:bg-slate-900/30 flex gap-4 items-center"
                        >
                          <div className="flex-1 min-w-0">
                            {orgWideMode && row.facilities?.name ? (
                              <p className="text-[9px] font-mono uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-0.5 truncate">
                                {row.facilities.name}
                              </p>
                            ) : null}
                            <p className="text-xs font-medium text-slate-900 dark:text-slate-300 truncate">
                              {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Unknown"}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate capitalize">
                              Status: {formatStatus(row.status)}
                            </p>
                            {passedAttachments.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {passedAttachments.map((a) => (
                                  <CompetencyCertificateOpenButton
                                    key={a.storage_path}
                                    storagePath={a.storage_path}
                                    label={a.label}
                                    className="h-7 text-[9px] px-2"
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 text-right">
                            {format(new Date(row.demonstrated_at), "MMM d")}
                          </span>
                        </MotionItem>
                      );
                      })}
                    </MotionList>
                  )}
                </>
              )}
            </MotionList>
            
          </div>

          {/* WATCHLIST: Compliance Tracking */}
          <div className="col-span-1 border-l border-white/10 dark:border-white/5 pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 dark:border-white/5 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Skills Compliance
              </h3>
            </div>
            
            <div className="space-y-4">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Counts below are from the last 50 competency demonstrations in this view (not scheduled{" "}
                <span className="font-mono">training_compliance_snapshots</span>).
              </p>
              <div className="glass-panel p-4 rounded-xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-900 dark:text-slate-100">Passed</p>
                  <span className="text-sm font-display font-medium text-emerald-600 dark:text-emerald-400">{statusCounts.passed}</span>
                </div>
              </div>
              <div className="glass-panel p-4 rounded-xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-900 dark:text-slate-100">Draft / submitted</p>
                  <span className="text-sm font-display font-medium text-amber-600 dark:text-amber-400">{statusCounts.pending}</span>
                </div>
              </div>
              <div className="glass-panel p-4 rounded-xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-900 dark:text-slate-100">Failed</p>
                  <span className="text-sm font-display font-medium text-rose-600 dark:text-rose-400">{statusCounts.failed}</span>
                </div>
              </div>
            </div>
            
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
