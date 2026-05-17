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
import { V2Card } from "@/components/ui/v2-card";
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

type StaffAttestationRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  staff_id: string;
  attestation_type: string;
  attestation_text: string;
  effective_date: string;
  expires_at: string | null;
  signed_at: string;
  signer_name: string | null;
  staff: { first_name: string; last_name: string } | null;
  facilities: { name: string } | null;
};

type ActiveStaffOption = {
  id: string;
  facility_id: string;
  organization_id: string;
  facility_name: string;
  name: string;
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
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DemoRow[]>([]);
  const [completionRows, setCompletionRows] = useState<CompletionRow[]>([]);
  const [inserviceRows, setInserviceRows] = useState<InserviceRow[]>([]);
  const [attestationRows, setAttestationRows] = useState<StaffAttestationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCompletions, setLoadingCompletions] = useState(true);
  const [loadingInservice, setLoadingInservice] = useState(true);
  const [loadingAttestations, setLoadingAttestations] = useState(true);
  const [loadingAttestationStaff, setLoadingAttestationStaff] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [inserviceError, setInserviceError] = useState<string | null>(null);
  const [attestationError, setAttestationError] = useState<string | null>(null);
  const [attestationFormError, setAttestationFormError] = useState<string | null>(null);
  const [attestationFormSuccess, setAttestationFormSuccess] = useState<string | null>(null);
  const [attestationSubmitting, setAttestationSubmitting] = useState(false);
  const [attestationStaffOptions, setAttestationStaffOptions] = useState<ActiveStaffOption[]>([]);
  const [attestationStaffId, setAttestationStaffId] = useState("");
  const [attestationType, setAttestationType] = useState("med_tech_self");
  const [attestationText, setAttestationText] = useState("");
  const [attestationEffectiveDate, setAttestationEffectiveDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [attestationExpiresAt, setAttestationExpiresAt] = useState("");
  const [attestationSignerName, setAttestationSignerName] = useState("");
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
    setLoadingAttestations(true);
    setLoadingAttestationStaff(true);
    setError(null);
    setCompletionError(null);
    setInserviceError(null);
    setAttestationError(null);
    setAttestationFormError(null);
    if (!facilityReady) {
      setRows([]);
      setCompletionRows([]);
      setInserviceRows([]);
      setLoading(false);
      setLoadingCompletions(false);
      setLoadingInservice(false);
      setLoadingAttestations(false);
      setLoadingAttestationStaff(false);
      setAttestationStaffOptions([]);
      return;
    }

    let q = supabase
      .from("competency_demonstrations")
      .select("*, staff(first_name, last_name), facilities(name)")
      .is("deleted_at", null)
      .order("demonstrated_at", { ascending: false })
      .limit(50);
    if (singleFacilityMode && selectedFacilityId) {
      q = q.eq("facility_id", selectedFacilityId);
    }

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

    let aq = supabase
      .from("staff_attestations" as never)
      .select(
        "id, organization_id, facility_id, staff_id, attestation_type, attestation_text, effective_date, expires_at, signed_at, signer_name, staff(first_name, last_name), facilities(name)",
      )
      .is("deleted_at", null)
      .order("signed_at", { ascending: false })
      .limit(50);
    if (singleFacilityMode && selectedFacilityId) {
      aq = aq.eq("facility_id", selectedFacilityId);
    }

    let sq = supabase
      .from("staff")
      .select("id, facility_id, organization_id, first_name, last_name, facilities(name)")
      .eq("employment_status", "active")
      .is("deleted_at", null)
      .order("last_name", { ascending: true })
      .limit(400);
    if (singleFacilityMode && selectedFacilityId) {
      sq = sq.eq("facility_id", selectedFacilityId);
    }

    const [demoRes, compRes, insRes, attRes, staffRes] = await Promise.all([q, cq, iq, aq, sq]);

    if (demoRes.error) {
      setError(demoRes.error.message || "Failed to load competency demonstrations.");
      setRows([]);
    } else {
      setRows((demoRes.data ?? []) as DemoRow[]);
    }
    setLoading(false);

    if (compRes.error) {
      setCompletionError(
        compRes.error.message || "Failed to load staff training completions.",
      );
      setCompletionRows([]);
    } else {
      setCompletionRows((compRes.data ?? []) as CompletionRow[]);
    }
    setLoadingCompletions(false);

    if (insRes.error) {
      setInserviceError(insRes.error.message || "Failed to load in-service sessions.");
      setInserviceRows([]);
    } else {
      setInserviceRows((insRes.data ?? []) as InserviceRow[]);
    }
    setLoadingInservice(false);

    if (attRes.error) {
      setAttestationError(attRes.error.message || "Failed to load staff attestations.");
      setAttestationRows([]);
    } else {
      setAttestationRows((attRes.data ?? []) as StaffAttestationRow[]);
    }
    setLoadingAttestations(false);

    if (staffRes.error) {
      setAttestationFormError(staffRes.error.message || "Failed to load active staff.");
      setAttestationStaffOptions([]);
    } else {
      setAttestationStaffOptions(
        ((staffRes.data ?? []) as {
          id: string;
          facility_id: string;
          organization_id: string;
          first_name: string;
          last_name: string;
          facilities: { name: string } | null;
        }[]).map((s) => ({
          id: s.id,
          facility_id: s.facility_id,
          organization_id: s.organization_id,
          facility_name: s.facilities?.name ?? "Facility",
          name: `${s.first_name} ${s.last_name}`.trim(),
        })),
      );
    }
    setLoadingAttestationStaff(false);
  }, [supabase, selectedFacilityId, facilityReady, singleFacilityMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAttestationStaff = useMemo(
    () => attestationStaffOptions.find((s) => s.id === attestationStaffId) ?? null,
    [attestationStaffId, attestationStaffOptions],
  );

  const handleAttestationSave = useCallback(async () => {
    setAttestationFormError(null);
    setAttestationFormSuccess(null);
    if (!facilityReady) {
      setAttestationFormError("Select a valid facility scope first.");
      return;
    }
    if (!attestationStaffId) {
      setAttestationFormError("Choose a staff member.");
      return;
    }
    if (!selectedAttestationStaff) {
      setAttestationFormError("Selected staff member is not available.");
      return;
    }
    if (!attestationType || !/^[a-z0-9_]+$/.test(attestationType)) {
      setAttestationFormError("Attestation type must use lowercase letters, numbers, and underscores.");
      return;
    }
    if (!attestationText.trim()) {
      setAttestationFormError("Attestation statement is required.");
      return;
    }
    if (!attestationEffectiveDate) {
      setAttestationFormError("Effective date is required.");
      return;
    }
    if (attestationExpiresAt && attestationExpiresAt < attestationEffectiveDate) {
      setAttestationFormError("Expiration date must be on or after the effective date.");
      return;
    }

    setAttestationSubmitting(true);
    try {
      const { error: insertError } = await supabase.from("staff_attestations" as never).insert({
        organization_id: selectedAttestationStaff.organization_id,
        facility_id: selectedAttestationStaff.facility_id,
        staff_id: attestationStaffId,
        attestation_type: attestationType,
        attestation_text: attestationText.trim(),
        effective_date: attestationEffectiveDate,
        expires_at: attestationExpiresAt || null,
        signer_name: attestationSignerName.trim() || null,
      } as never);
      if (insertError) throw insertError;

      setAttestationText("");
      setAttestationExpiresAt("");
      setAttestationSignerName("");
      setAttestationFormSuccess("Attestation recorded.");
      await load();
    } catch (e) {
      setAttestationFormError(e instanceof Error ? e.message : "Failed to save attestation.");
    } finally {
      setAttestationSubmitting(false);
    }
  }, [
    attestationEffectiveDate,
    attestationExpiresAt,
    attestationSignerName,
    attestationStaffId,
    attestationText,
    attestationType,
    facilityReady,
    load,
    selectedAttestationStaff,
    supabase,
  ]);

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
      <></>
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              Training & Competency
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <></>
              <MonolithicWatermark value={rows.length} className="text-primary/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5" /> Demos Completed
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{rows.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[190px]">
            <V2Card hoverColor="blue" className="p-5 lg:p-6">
              <div className="relative z-10 flex h-full w-full flex-col justify-center gap-4 text-left lg:items-end lg:text-right">
                     <p className="hidden max-w-lg text-xs leading-relaxed text-muted-foreground lg:block">
                   {orgWideMode
                     ? "Last 50 competency demonstrations across your accessible facilities (ordered by date). RLS enforces scope."
                     : "Documented skills demonstrations for the selected facility."}
                 </p>
                 <div className="flex w-full flex-col items-start gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
                   <Button
                     type="button"
                     variant="outline"
                     disabled={!facilityReady || exportingCsv}
                     className="h-auto min-h-10 whitespace-normal text-left font-mono uppercase tracking-wider text-[10px] sm:whitespace-nowrap"
                     onClick={() => void exportDemonstrationsCsv()}
                   >
                     {exportingCsv ? "Preparing…" : "Download demonstrations CSV"}
                   </Button>
                   {orgWideMode ? (
                     <Button
                       type="button"
                       disabled
                       className="h-auto min-h-10 whitespace-normal text-left font-mono uppercase tracking-wider text-[10px] opacity-70 sm:whitespace-nowrap"
                       title="Select a single facility in the header to record a new demonstration."
                     >
                       + New Demonstration
                     </Button>
                   ) : (
                     <Link
                       href="/admin/training/new"
                     className={cn(
                        buttonVariants({ size: "default" }),
                        "h-auto min-h-10 whitespace-normal text-left font-mono uppercase tracking-wider text-[10px] tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground border-none sm:whitespace-nowrap",
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
          <div className="space-y-4 border-t border-border pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  Staff training completions
                </h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Last 50 completion records per facility scope (RLS). Log new completions for a single
                  facility; export supports audits.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {orgWideMode ? (
                  <Button
                    type="button"
                    disabled
                    className="shrink-0 font-mono uppercase tracking-wider text-[10px] opacity-70"
                    title="Select a single facility in the header to log a completion."
                  >
                    + Log completion
                  </Button>
                ) : (
                  <Link
                    href="/admin/training/completions/new"
                    className={cn(
                      buttonVariants({ size: "default" }),
                      "shrink-0 font-mono uppercase tracking-wider text-[10px] tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground border-none",
                    )}
                  >
                    + Log completion
                  </Link>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!facilityReady || exportingCompletionsCsv}
                  className="shrink-0 font-mono uppercase tracking-wider text-[10px]"
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
              <p className="text-sm text-muted-foreground">Loading completions…</p>
            ) : completionRows.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
                <p className="font-medium text-foreground">No completion rows yet</p>
                <p className="mt-1 text-sm opacity-80">
                  Florida catalog programs are ready to assign. Select a facility and use{" "}
                  <span className="font-mono">+ Log completion</span> to add a live completion row.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border uppercase tracking-wider text-muted-foreground">
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Facility</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Staff</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Program</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Completed</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Expires</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Hours</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Delivery</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completionRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border text-foreground last:border-0 hover:bg-muted/40 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]"
                      >
                        <td className="px-[13px] py-2 font-mono text-[10px] text-primary">
                          {row.facilities?.name ?? "—"}
                        </td>
                        <td className="px-[13px] py-2 text-[13px]">
                          {row.staff
                            ? `${row.staff.first_name} ${row.staff.last_name}`
                            : "—"}
                        </td>
                        <td className="px-[13px] py-2 text-[13px]">
                          <span className="font-medium">{row.training_programs?.name ?? "—"}</span>
                          {row.training_programs?.code ? (
                            <span className="ml-1 text-[12px] text-muted-foreground">
                              ({row.training_programs.code})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[12px] tabular-nums">
                          {row.completed_at
                            ? format(new Date(`${row.completed_at}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[12px] tabular-nums">
                          {row.expires_at
                            ? format(new Date(`${row.expires_at}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-[13px] py-2 font-mono tabular-nums">{formatHours(row.hours_completed)}</td>
                        <td className="px-[13px] py-2 capitalize text-muted-foreground">
                          {formatStatus(row.delivery_method)}
                        </td>
                        <td className="px-[13px] py-2">
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

          <div className="space-y-4 border-t border-border pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  Staff attestations (compliance)
                </h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Last 50 attestation records from <span className="font-mono">staff_attestations</span>.
                  Includes annual med-tech attestation visibility for COL-HR-008 review.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Record attestation
              </h4>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Add a signed attestation for active staff. In All facilities mode, choose staff from any
                accessible facility.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs text-foreground">
                  <span className="font-medium">Staff member *</span>
                  <select
                    value={attestationStaffId}
                    onChange={(e) => setAttestationStaffId(e.target.value)}
                    disabled={!facilityReady || loadingAttestationStaff || attestationSubmitting}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground"
                  >
                    <option value="">Select staff…</option>
                    {attestationStaffOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {orgWideMode ? ` (${s.facility_name})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-foreground">
                  <span className="font-medium">Attestation type *</span>
                  <select
                    value={attestationType}
                    onChange={(e) => setAttestationType(e.target.value)}
                    disabled={attestationSubmitting}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground"
                  >
                    <option value="med_tech_self">Medication Tech self-attestation</option>
                    <option value="general_staff">General staff attestation</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-foreground">
                  <span className="font-medium">Effective date *</span>
                  <input
                    type="date"
                    value={attestationEffectiveDate}
                    onChange={(e) => setAttestationEffectiveDate(e.target.value)}
                    disabled={attestationSubmitting}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground"
                  />
                </label>
                <label className="space-y-1 text-xs text-foreground">
                  <span className="font-medium">Expires date</span>
                  <input
                    type="date"
                    value={attestationExpiresAt}
                    onChange={(e) => setAttestationExpiresAt(e.target.value)}
                    disabled={attestationSubmitting}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground"
                  />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <label className="space-y-1 text-xs text-foreground">
                  <span className="font-medium">Attestation statement *</span>
                  <textarea
                    value={attestationText}
                    onChange={(e) => setAttestationText(e.target.value)}
                    rows={3}
                    disabled={attestationSubmitting}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground"
                    placeholder="Staff confirms scope, training, and escalation expectations are understood."
                  />
                </label>
                <label className="space-y-1 text-xs text-foreground">
                  <span className="font-medium">Signer name</span>
                  <input
                    type="text"
                    value={attestationSignerName}
                    onChange={(e) => setAttestationSignerName(e.target.value)}
                    disabled={attestationSubmitting}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground"
                    placeholder="Jane Supervisor"
                  />
                </label>
              </div>
              {attestationFormError ? (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                  {attestationFormError}
                </p>
              ) : null}
              {attestationFormSuccess ? (
                <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                  {attestationFormSuccess}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  onClick={() => void handleAttestationSave()}
                  disabled={!facilityReady || loadingAttestationStaff || attestationSubmitting}
                  className="font-mono uppercase tracking-wider text-[10px]"
                >
                  {attestationSubmitting ? "Saving…" : "Save attestation"}
                </Button>
              </div>
            </div>
            {attestationError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                {attestationError}
              </p>
            )}
            {loadingAttestations ? (
              <p className="text-sm text-muted-foreground">Loading attestations…</p>
            ) : attestationRows.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
                <p className="font-medium text-foreground">No attestations yet</p>
                <p className="mt-1 text-sm opacity-80">
                  Staff attestation records will appear here once signed.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border uppercase tracking-wider text-muted-foreground">
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Facility</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Staff</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Type</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Signed</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Effective</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Expires</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Signer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attestationRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border text-foreground last:border-0 hover:bg-muted/40 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]"
                      >
                        <td className="px-[13px] py-2 font-mono text-[10px] text-primary">
                          {row.facilities?.name ?? "—"}
                        </td>
                        <td className="px-[13px] py-2 text-[13px]">
                          {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "—"}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[10px] uppercase tracking-wider">
                          {row.attestation_type.replace(/_/g, " ")}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[12px] tabular-nums">
                          {row.signed_at ? format(new Date(row.signed_at), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[12px] tabular-nums">
                          {row.effective_date
                            ? format(new Date(`${row.effective_date}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[12px] tabular-nums">
                          {row.expires_at
                            ? format(new Date(`${row.expires_at}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-[13px] py-2 text-[13px]">{row.signer_name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-4 border-t border-border pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  In-service sessions
                </h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Last 50 in-service events (RLS). Create a session for one facility at a time; export for
                  audits.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {orgWideMode ? (
                  <Button
                    type="button"
                    disabled
                    className="shrink-0 font-mono uppercase tracking-wider text-[10px] opacity-70"
                    title="Select a single facility in the header to record a new in-service session."
                  >
                    + New in-service session
                  </Button>
                ) : (
                  <Link
                    href="/admin/training/inservice/new"
                    className={cn(
                      buttonVariants({ size: "default" }),
                      "shrink-0 font-mono uppercase tracking-wider text-[10px] tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground border-none",
                    )}
                  >
                    + New in-service session
                  </Link>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!facilityReady || exportingInserviceCsv}
                  className="shrink-0 font-mono uppercase tracking-wider text-[10px]"
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
              <p className="text-sm text-muted-foreground">Loading in-service sessions…</p>
            ) : inserviceRows.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
                <p className="font-medium text-foreground">No in-service sessions yet</p>
                <p className="mt-1 text-sm opacity-80">
                  Select a facility and use <span className="font-mono">+ New in-service session</span> to log
                  attendance.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border uppercase tracking-wider text-muted-foreground">
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Facility</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Date</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Topic</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Trainer</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Hours</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Program</th>
                      <th className="px-[13px] py-2 text-[10px] font-semibold">Attendees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inserviceRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border text-foreground last:border-0 hover:bg-muted/40 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]"
                      >
                        <td className="px-[13px] py-2 font-mono text-[10px] text-primary">
                          {row.facilities?.name ?? "—"}
                        </td>
                        <td className="px-[13px] py-2 font-mono text-[12px] tabular-nums">
                          {row.session_date
                            ? format(new Date(`${row.session_date}T12:00:00`), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-[13px] py-2 max-w-[200px] truncate text-[13px]" title={row.topic}>
                          {row.topic}
                        </td>
                        <td className="px-[13px] py-2 text-[13px]">{row.trainer_name}</td>
                        <td className="px-[13px] py-2 font-mono tabular-nums">{formatHours(Number(row.hours))}</td>
                        <td className="px-[13px] py-2 text-[13px]">
                          {row.training_programs?.name ? (
                            <span className="font-medium">{row.training_programs.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-[13px] py-2 font-mono tabular-nums">
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
        <p className="rounded-lg border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
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
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                Pending Evaluations & Overdue Skills
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {attentionRows.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground bg-card rounded-xl border border-border">
                      <p className="font-medium text-foreground">No open demonstrations</p>
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
                          "p-5 rounded-xl border bg-card relative overflow-hidden group transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 cursor-pointer",
                          border,
                        )}
                      >
                        <div className={cn("absolute top-0 left-0 w-1 h-full", bar)} />
                        <div className="flex justify-between items-start mb-4">
                          <span
                            className={cn(
                              "text-[9px] font-mono font-bold shadow-sm px-2 py-1 rounded-md uppercase tracking-wider",
                              badge,
                            )}
                          >
                            {title}
                          </span>
                          <span className="flex flex-col items-end gap-1 text-right sm:flex-row sm:items-center sm:gap-2">
                            {orgWideMode && row.facilities?.name ? (
                              <span className="text-[9px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-mono font-bold bg-indigo-500/10 px-2 py-0.5 rounded">
                                {row.facilities.name}
                              </span>
                            ) : null}
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono font-bold bg-muted/40 px-2 py-0.5 rounded">
                              Session {format(new Date(row.demonstrated_at), "MMM d, yyyy")}
                            </span>
                          </span>
                        </div>
                        <div className="mb-4">
                          <p className="text-sm font-medium text-foreground mb-1">
                            {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Staff"} —{" "}
                            {formatStatus(row.status)}
                          </p>
                          {row.notes ? (
                            <p className="text-xs text-muted-foreground line-clamp-3">{row.notes}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
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
                                  className="h-8 text-[10px] font-mono uppercase tracking-wider"
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
                              "text-white font-mono uppercase tracking-wider text-[10px]",
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
                          className="p-3 rounded-xl border border-border bg-card flex gap-4 items-center"
                        >
                          <div className="flex-1 min-w-0">
                            {orgWideMode && row.facilities?.name ? (
                              <p className="text-[9px] font-mono uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-0.5 truncate">
                                {row.facilities.name}
                              </p>
                            ) : null}
                            <p className="text-xs font-medium text-foreground truncate">
                              {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Unknown"}
                            </p>
                            <p className="text-[12px] text-muted-foreground truncate capitalize">
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
                          <span className="text-[10px] font-mono tabular-nums text-primary text-right">
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
          <div className="col-span-1 border-l border-border pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-border mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                Skills Compliance
              </h3>
            </div>
            
            <div className="space-y-4">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Counts below are from the last 50 competency demonstrations in this view (not scheduled{" "}
                <span className="font-mono">training_compliance_snapshots</span>).
              </p>
              <div className="p-4 rounded-xl border border-border bg-card flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Passed</p>
                  <span className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{statusCounts.passed}</span>
                </div>
              </div>
              <div className="p-4 rounded-xl border border-border bg-card flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Draft / submitted</p>
                  <span className="text-sm font-medium tabular-nums text-amber-600 dark:text-amber-400">{statusCounts.pending}</span>
                </div>
              </div>
              <div className="p-4 rounded-xl border border-border bg-card flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Failed</p>
                  <span className="text-sm font-medium tabular-nums text-rose-600 dark:text-rose-400">{statusCounts.failed}</span>
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
