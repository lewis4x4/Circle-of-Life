"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";

import { AdmissionsHubNav } from "../admissions-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatColLabel } from "@/lib/col-labels";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

type CaseDetail = Database["public"]["Tables"]["admission_cases"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
  referral_leads: { first_name: string; last_name: string } | null;
  beds: { bed_label: string } | null;
};

type OnboardingCounts = {
  carePlans: number;
  medications: number;
  payers: number;
  familyConsents: number;
};

type RateScheduleOption = Pick<
  Database["public"]["Tables"]["rate_schedules"]["Row"],
  | "id"
  | "name"
  | "effective_date"
  | "base_rate_private"
  | "base_rate_semi_private"
  | "care_surcharge_level_1"
  | "care_surcharge_level_2"
  | "care_surcharge_level_3"
>;

type BedOption = {
  id: string;
  bed_label: string;
};

type Form1823Record = {
  id: string;
  status: "pending" | "received" | "expired" | "renewal_due";
  physician_name: string | null;
  exam_date: string | null;
  expiration_date: string | null;
  updated_at: string;
};

type AdmissionChecklistItem = {
  id: string;
  received_at: string | null;
  notes: string | null;
  waived_reason: string | null;
};

type MedicaidPipelineStage = "prospect" | "app_requested" | "pending" | "approved" | "denied" | "waitlist";

const MEDICAID_PIPELINE_STAGE_OPTIONS: Array<{ value: MedicaidPipelineStage; label: string }> = [
  { value: "prospect", label: "Prospect" },
  { value: "app_requested", label: "Application requested" },
  { value: "pending", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "waitlist", label: "Waitlist" },
];

function formatStatus(s: string) {
  return formatColLabel(s);
}

function formatTs(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatCents(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function admissionReadinessChecklist(
  row: CaseDetail,
  rateTerms: Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][],
  form1823Satisfied: boolean,
) {
  return [
    {
      key: "financial",
      label: "Financial clearance recorded",
      passed: Boolean(row.financial_clearance_at),
    },
    {
      key: "orders",
      label: "Physician orders received",
      passed: Boolean(row.physician_orders_received_at),
    },
    {
      key: "bed",
      label: "Bed assigned or reserved",
      passed: Boolean(row.bed_id),
    },
    {
      key: "move_in_date",
      label: "Target move-in date set",
      passed: Boolean(row.target_move_in_date),
    },
    {
      key: "rate_terms",
      label: "Rate terms recorded",
      passed: rateTerms.length > 0,
    },
    {
      key: "form_1823",
      label: "Form 1823 received",
      passed: form1823Satisfied,
    },
  ];
}

function onboardingLinks(residentId: string | null) {
  if (!residentId) return [];
  return [
    { label: "Resident profile", href: `/admin/residents/${residentId}` },
    { label: "Care plan workspace", href: `/admin/residents/${residentId}/care-plan` },
    { label: "Medication setup", href: `/admin/residents/${residentId}/medications` },
    { label: "Resident billing", href: `/admin/residents/${residentId}/billing` },
    { label: "Family coordination", href: "/admin/family-messages" },
  ];
}

function onboardingChecklist(counts: OnboardingCounts) {
  return [
    {
      key: "care_plan",
      label: "Care plan workspace has at least one plan",
      passed: counts.carePlans > 0,
    },
    {
      key: "meds",
      label: "Medication profile exists",
      passed: counts.medications > 0,
    },
    {
      key: "billing",
      label: "Resident payer is configured",
      passed: counts.payers > 0,
    },
    {
      key: "family",
      label: "Family consent is on file",
      passed: counts.familyConsents > 0,
    },
  ];
}

export default function AdminAdmissionCaseDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [rateTerms, setRateTerms] = useState<Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][]>([]);
  const [onboardingCounts, setOnboardingCounts] = useState<OnboardingCounts>({
    carePlans: 0,
    medications: 0,
    payers: 0,
    familyConsents: 0,
  });
  const [rateSchedules, setRateSchedules] = useState<RateScheduleOption[]>([]);
  const [beds, setBeds] = useState<BedOption[]>([]);
  const [form1823Record, setForm1823Record] = useState<Form1823Record | null>(null);
  const [form1823ChecklistItem, setForm1823ChecklistItem] = useState<AdmissionChecklistItem | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [targetMoveInDraft, setTargetMoveInDraft] = useState("");
  const [bedDraft, setBedDraft] = useState("");
  const [physicianOrdersSummaryDraft, setPhysicianOrdersSummaryDraft] = useState("");
  const [caseNotesDraft, setCaseNotesDraft] = useState("");
  const [medicaidPipelineStageDraft, setMedicaidPipelineStageDraft] = useState<MedicaidPipelineStage>("prospect");
  const [rateScheduleDraft, setRateScheduleDraft] = useState("");
  const [rateAccommodationDraft, setRateAccommodationDraft] =
    useState<Database["public"]["Enums"]["admission_accommodation_quote"]>("private");
  const [rateCareLevelDraft, setRateCareLevelDraft] = useState<"1" | "2" | "3">("2");
  const [quotedBaseDraft, setQuotedBaseDraft] = useState("");
  const [quotedCareDraft, setQuotedCareDraft] = useState("");
  const [effectiveDateDraft, setEffectiveDateDraft] = useState("");
  const [rateNotesDraft, setRateNotesDraft] = useState("");
  const [editingRateTermId, setEditingRateTermId] = useState<string | null>(null);
  const [form1823StatusDraft, setForm1823StatusDraft] = useState<Form1823Record["status"]>("pending");
  const [form1823PhysicianDraft, setForm1823PhysicianDraft] = useState("");
  const [form1823ExamDateDraft, setForm1823ExamDateDraft] = useState("");
  const [form1823ExpirationDraft, setForm1823ExpirationDraft] = useState("");
  const [form1823NotesDraft, setForm1823NotesDraft] = useState("");

  const load = useCallback(async () => {
    if (!id) {
      setRow(null);
      setRateTerms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [{ data: c, error: cErr }, { data: rt }] = await Promise.all([
      supabase
        .from("admission_cases")
        .select("*, residents(first_name, last_name), referral_leads(first_name, last_name), beds(bed_label)")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase.from("admission_case_rate_terms").select("*").eq("admission_case_id", id),
    ]);

    if (cErr) {
      setError(cErr.message);
      setRow(null);
      setRateTerms([]);
    } else {
      const caseRow = c as CaseDetail | null;
      setRow(caseRow);
      setRateTerms((rt ?? []) as Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][]);
      setTargetMoveInDraft(caseRow?.target_move_in_date ?? "");
      setBedDraft(caseRow?.bed_id ?? "");
      setPhysicianOrdersSummaryDraft(caseRow?.physician_orders_summary ?? "");
      setCaseNotesDraft(caseRow?.notes ?? "");
      setMedicaidPipelineStageDraft((caseRow?.medicaid_pipeline_stage as MedicaidPipelineStage | null) ?? "prospect");
      setEffectiveDateDraft(caseRow?.target_move_in_date ?? "");
      if (caseRow?.facility_id) {
        const [{ data: schedules, error: schedulesError }, { data: bedRows, error: bedsError }] = await Promise.all([
          supabase
            .from("rate_schedules")
            .select("id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3")
            .eq("facility_id", caseRow.facility_id)
            .is("deleted_at", null)
            .order("effective_date", { ascending: false }),
          supabase
            .from("beds")
            .select("id, bed_label")
            .eq("facility_id", caseRow.facility_id)
            .is("deleted_at", null)
            .in("status", ["available", "hold"])
            .order("bed_label"),
        ]);
        if (schedulesError) throw schedulesError;
        if (bedsError) throw bedsError;
        setRateSchedules((schedules ?? []) as RateScheduleOption[]);
        setBeds((bedRows ?? []) as BedOption[]);
      } else {
        setRateSchedules([]);
        setBeds([]);
      }
      if (caseRow?.resident_id) {
        const [carePlansRes, medsRes, payersRes, consentsRes, form1823CaseRes, form1823ChecklistRes, form1823ResidentFallbackRes] = await Promise.all([
          supabase.from("care_plans").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase.from("resident_medications").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase.from("resident_payers").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase.from("family_consent_records").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase
            .from("form_1823_records" as never)
            .select("id, status, physician_name, exam_date, expiration_date, updated_at")
            .eq("admission_case_id", caseRow.id)
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("admission_document_checklist_items" as never)
            .select("id, received_at, notes, waived_reason")
            .eq("admission_case_id", caseRow.id)
            .eq("document_type", "form_1823")
            .is("deleted_at", null)
            .maybeSingle(),
          supabase
            .from("form_1823_records" as never)
            .select("id, status, physician_name, exam_date, expiration_date, updated_at")
            .eq("resident_id", caseRow.resident_id)
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        setOnboardingCounts({
          carePlans: carePlansRes.count ?? 0,
          medications: medsRes.count ?? 0,
          payers: payersRes.count ?? 0,
          familyConsents: consentsRes.count ?? 0,
        });
        const resolvedForm1823Record = ((form1823CaseRes.data ?? form1823ResidentFallbackRes.data) ?? null) as Form1823Record | null;
        const resolvedChecklist = (form1823ChecklistRes.data ?? null) as AdmissionChecklistItem | null;
        setForm1823Record(resolvedForm1823Record);
        setForm1823ChecklistItem(resolvedChecklist);
        setForm1823StatusDraft(resolvedForm1823Record?.status ?? "pending");
        setForm1823PhysicianDraft(resolvedForm1823Record?.physician_name ?? "");
        setForm1823ExamDateDraft(resolvedForm1823Record?.exam_date ?? "");
        setForm1823ExpirationDraft(resolvedForm1823Record?.expiration_date ?? "");
        setForm1823NotesDraft(resolvedChecklist?.notes ?? "");
      } else {
        setOnboardingCounts({ carePlans: 0, medications: 0, payers: 0, familyConsents: 0 });
        setForm1823Record(null);
        setForm1823ChecklistItem(null);
        setForm1823StatusDraft("pending");
        setForm1823PhysicianDraft("");
        setForm1823ExamDateDraft("");
        setForm1823ExpirationDraft("");
        setForm1823NotesDraft("");
      }
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const wrongFacility =
    row &&
    selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    row.facility_id !== selectedFacilityId;

  async function updateCase(patch: Partial<Database["public"]["Tables"]["admission_cases"]["Update"]>, successMessage: string) {
    if (!row) return;
    setActionLoading(successMessage);
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/admin/workflows/admission-cases/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Could not update admission case.");
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update admission case.");
    } finally {
      setActionLoading(null);
    }
  }

  async function saveForm1823() {
    if (!row) return;
    setActionLoading("form-1823");
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/admin/workflows/admission-cases/${row.id}/form-1823`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form1823StatusDraft,
          physician_name: form1823PhysicianDraft.trim() || null,
          exam_date: form1823ExamDateDraft || null,
          expiration_date: form1823ExpirationDraft || null,
          notes: form1823NotesDraft.trim() || null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Could not save Form 1823.");
      setActionMessage(
        form1823StatusDraft === "received"
          ? "Form 1823 recorded and admission gate satisfied."
          : "Form 1823 status saved."
      );
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save Form 1823.");
    } finally {
      setActionLoading(null);
    }
  }

  const form1823Satisfied = Boolean(form1823Record?.status === "received" && form1823ChecklistItem?.received_at);
  const readiness = row ? admissionReadinessChecklist(row, rateTerms, form1823Satisfied) : [];
  const canReserveBed = Boolean(row?.financial_clearance_at && row?.physician_orders_received_at && row?.bed_id);
  const canAdvanceMoveIn = Boolean(canReserveBed && row?.target_move_in_date && rateTerms.length > 0 && form1823Satisfied);
  const onboarding = onboardingChecklist(onboardingCounts);
  const selectedRateSchedule = rateSchedules.find((schedule) => schedule.id === rateScheduleDraft) ?? null;

  function prefillQuotedTermsFromSchedule() {
    if (!selectedRateSchedule) return;
    const base =
      rateAccommodationDraft === "private"
        ? selectedRateSchedule.base_rate_private
        : selectedRateSchedule.base_rate_semi_private ?? selectedRateSchedule.base_rate_private;
    const care =
      rateCareLevelDraft === "1"
        ? selectedRateSchedule.care_surcharge_level_1
        : rateCareLevelDraft === "2"
          ? selectedRateSchedule.care_surcharge_level_2
          : selectedRateSchedule.care_surcharge_level_3;
    setQuotedBaseDraft(String(base));
    setQuotedCareDraft(String(care));
    setEffectiveDateDraft((current) => current || selectedRateSchedule.effective_date || "");
  }

  async function addRateTerm() {
    if (!row) return;
    const base = Number.parseInt(quotedBaseDraft, 10);
    const care = Number.parseInt(quotedCareDraft || "0", 10);
    if (Number.isNaN(base)) {
      setActionError("Quoted base rate must be a whole-number cents value.");
      setActionMessage(null);
      return;
    }
    if (Number.isNaN(care)) {
      setActionError("Quoted care surcharge must be a whole-number cents value.");
      setActionMessage(null);
      return;
    }
    setActionLoading("rate-term");
    setActionError(null);
    setActionMessage(null);
    try {
      if (editingRateTermId) {
        const { error: updateError } = await supabase
          .from("admission_case_rate_terms")
          .update({
            rate_schedule_id: rateScheduleDraft || null,
            accommodation_type: rateAccommodationDraft,
            quoted_base_rate_cents: base,
            quoted_care_surcharge_cents: care,
            effective_date: effectiveDateDraft || null,
            notes: rateNotesDraft.trim() || null,
          })
          .eq("id", editingRateTermId);
        if (updateError) throw updateError;
        setActionMessage("Quoted rate terms updated.");
      } else {
        const { error: insertError } = await supabase
          .from("admission_case_rate_terms")
          .insert({
            admission_case_id: row.id,
            rate_schedule_id: rateScheduleDraft || null,
            accommodation_type: rateAccommodationDraft,
            quoted_base_rate_cents: base,
            quoted_care_surcharge_cents: care,
            effective_date: effectiveDateDraft || null,
            notes: rateNotesDraft.trim() || null,
            created_by: user?.id ?? null,
          });
        if (insertError) throw insertError;
        setActionMessage("Quoted rate terms saved.");
      }
      setEditingRateTermId(null);
      setRateScheduleDraft("");
      setRateAccommodationDraft("private");
      setRateCareLevelDraft("2");
      setQuotedBaseDraft("");
      setQuotedCareDraft("");
      setRateNotesDraft("");
      setEffectiveDateDraft(row.target_move_in_date ?? "");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save rate terms.");
    } finally {
      setActionLoading(null);
    }
  }

  function startEditingRateTerm(term: Database["public"]["Tables"]["admission_case_rate_terms"]["Row"]) {
    setEditingRateTermId(term.id);
    setRateScheduleDraft(term.rate_schedule_id ?? "");
    setRateAccommodationDraft(term.accommodation_type);
    setQuotedBaseDraft(String(term.quoted_base_rate_cents));
    setQuotedCareDraft(String(term.quoted_care_surcharge_cents));
    setEffectiveDateDraft(term.effective_date ?? row?.target_move_in_date ?? "");
    setRateNotesDraft(term.notes ?? "");
  }

  function clearRateTermForm() {
    setEditingRateTermId(null);
    setRateScheduleDraft("");
    setRateAccommodationDraft("private");
    setRateCareLevelDraft("2");
    setQuotedBaseDraft("");
    setQuotedCareDraft("");
    setEffectiveDateDraft(row?.target_move_in_date ?? "");
    setRateNotesDraft("");
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      
      <div className="relative z-10 space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <AdmissionsHubNav />
        <RecordDetailHeader
          title="Admission Case"
          subtitle="Operational workspace for move-in readiness, quoted terms, and downstream onboarding."
          backLink={{ label: "Back to admissions", href: "/admin/admissions" }}
          actions={
            row?.resident_id ? (
              <Link
                href={`/admin/residents/${row.resident_id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              >
                Resident Profile
              </Link>
            ) : undefined
          }
        />

        {loading ? (
          <div className="flex items-center justify-center p-12 text-sm text-muted-foreground bg-card rounded-[8px] border border-border">
             <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Case...
          </div>
        ) : error ? (
           <div className="p-4 rounded-[8px] border border-destructive/20 bg-destructive/10 text-destructive font-medium" role="alert">
              {error}
           </div>
        ) : !row ? (
          <div className="flex items-center justify-center p-12 text-center text-sm text-muted-foreground bg-card rounded-[8px] border border-border">
            No case found for this id, or you do not have access.
          </div>
        ) : (
          <>
            {actionError ? (
              <div className="p-4 rounded-[8px] border border-destructive/20 bg-destructive/10 text-destructive font-medium text-sm" role="alert">
                {actionError}
              </div>
            ) : null}
            {actionMessage ? (
              <div className="p-4 rounded-[8px] border border-success/20 bg-success/10 text-success font-medium text-sm">
                {actionMessage}
              </div>
            ) : null}
            {wrongFacility && (
              <div className="p-4 rounded-[8px] border border-warning/20 bg-warning/10 text-warning font-medium text-sm">
                This case belongs to another facility. Switch the facility in the header to match.
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RecordDetailSection
                title={row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident"}
                description={`Case ID: ${row.id}`}
              >
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Status</dt>
                    <dd className="text-base font-semibold text-foreground capitalize">{formatStatus(row.status)}</dd>
                  </div>
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Medicaid Stage</dt>
                    <dd className="text-base font-semibold text-foreground capitalize">{formatStatus(row.medicaid_pipeline_stage ?? "prospect")}</dd>
                  </div>
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Target Move-In</dt>
                    <dd className="text-base font-semibold text-foreground">{row.target_move_in_date ?? "—"}</dd>
                  </div>
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Referral Lead</dt>
                    <dd className="text-sm font-medium text-foreground">
                      {row.referral_leads ? `${row.referral_leads.first_name} ${row.referral_leads.last_name}` : "—"}
                    </dd>
                  </div>
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Bed</dt>
                    <dd className="text-sm font-medium text-foreground">{row.beds?.bed_label ?? "—"}</dd>
                  </div>
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Financial Clearance</dt>
                    <dd className="text-sm font-mono text-foreground">{formatTs(row.financial_clearance_at)}</dd>
                  </div>
                  <div className="p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Physician Orders</dt>
                    <dd className="text-sm font-mono text-foreground">{formatTs(row.physician_orders_received_at)}</dd>
                  </div>
                  <div className="sm:col-span-2 p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Medicaid Pipeline Tracking</dt>
                    <dd className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <select
                          value={medicaidPipelineStageDraft}
                          onChange={(event) => setMedicaidPipelineStageDraft(event.target.value as MedicaidPipelineStage)}
                          className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {MEDICAID_PIPELINE_STAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={actionLoading === "Medicaid stage saved." || medicaidPipelineStageDraft === (row.medicaid_pipeline_stage ?? "prospect")}
                          onClick={() => void updateCase({ medicaid_pipeline_stage: medicaidPipelineStageDraft }, "Medicaid stage saved.")}
                        >
                          {actionLoading === "Medicaid stage saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save stage"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Keep this in sync with the COL Medicaid workflow while the main admission status stays unchanged.
                      </p>
                    </dd>
                  </div>
                  <div className="sm:col-span-2 p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Physician Orders Summary</dt>
                    <dd className="space-y-3">
                      <textarea
                        value={physicianOrdersSummaryDraft}
                        onChange={(event) => setPhysicianOrdersSummaryDraft(event.target.value)}
                        rows={4}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={actionLoading === "Physician orders summary saved." || physicianOrdersSummaryDraft === (row.physician_orders_summary ?? "")}
                          onClick={() =>
                            void updateCase(
                              { physician_orders_summary: physicianOrdersSummaryDraft.trim() || null },
                              "Physician orders summary saved.",
                            )
                          }
                        >
                          {actionLoading === "Physician orders summary saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save summary"}
                        </Button>
                      </div>
                    </dd>
                  </div>
                  <div className="sm:col-span-2 p-4 rounded-[8px] border border-border bg-card">
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Notes</dt>
                    <dd className="space-y-3">
                      <textarea
                        value={caseNotesDraft}
                        onChange={(event) => setCaseNotesDraft(event.target.value)}
                        rows={4}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={actionLoading === "Admission notes saved." || caseNotesDraft === (row.notes ?? "")}
                          onClick={() =>
                            void updateCase(
                              { notes: caseNotesDraft.trim() || null },
                              "Admission notes saved.",
                            )
                          }
                        >
                          {actionLoading === "Admission notes saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save notes"}
                        </Button>
                      </div>
                    </dd>
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-end text-[10px] text-muted-foreground uppercase tracking-wider font-mono mt-2">
                    Updated: {formatTs(row.updated_at)}
                  </div>
                </dl>
              </RecordDetailSection>

              <RecordDetailSection title="Move-In Readiness" description="Operational checklist">
                <div className="space-y-3">
                  {readiness.map((item) => (
                    <div key={item.key} className="rounded-[8px] border border-border bg-card px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                      <span className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                        item.passed
                          ? "bg-success/10 text-success"
                          : "bg-warning/10 text-warning",
                      )}>
                        {item.passed ? "Complete" : "Missing"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-[8px] border border-border bg-card p-4">
                  <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground mb-2">Next actions</p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-foreground">
                    {!row.financial_clearance_at ? <li>Record financial clearance before move-in.</li> : null}
                    {!row.physician_orders_received_at ? <li>Capture physician orders receipt before move-in.</li> : null}
                    {!row.bed_id ? <li>Reserve or assign a bed.</li> : null}
                    {!row.target_move_in_date ? <li>Set a target move-in date.</li> : null}
                    {rateTerms.length === 0 ? <li>Add quoted rate terms for the admission package.</li> : null}
                    {!form1823Satisfied ? <li>Record Form 1823 as received before move-in.</li> : null}
                    {row.financial_clearance_at && row.physician_orders_received_at && row.bed_id && row.target_move_in_date && rateTerms.length > 0 && form1823Satisfied ? (
                      <li>Core readiness items are in place. Advance this case through the move-in workflow.</li>
                    ) : null}
                  </ul>
                </div>
                <div className="mt-5 rounded-[8px] border border-border bg-card p-4 space-y-4">
                  <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Workflow actions</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(row.financial_clearance_at) || !!actionLoading}
                      onClick={() => void updateCase({ financial_clearance_at: new Date().toISOString(), financial_clearance_by: user?.id ?? null }, "Financial clearance recorded.")}
                    >
                      {actionLoading === "Financial clearance recorded." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark financial clearance"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(row.physician_orders_received_at) || !!actionLoading}
                      onClick={() => void updateCase({ physician_orders_received_at: new Date().toISOString() }, "Physician orders recorded.")}
                    >
                      {actionLoading === "Physician orders recorded." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark physician orders received"}
                    </Button>
                  </div>
                <div className="rounded-[8px] border border-info/20 bg-info/10 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Form 1823 gate</p>
                      <p className="mt-1 text-sm text-foreground">
                        Move-in requires a received Form 1823 for this admission case.
                      </p>
                    </div>
                    <span className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                      form1823Satisfied
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning",
                    )}>
                      {form1823Satisfied ? "Satisfied" : "Blocked"}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
                      <select
                        value={form1823StatusDraft}
                        onChange={(event) => setForm1823StatusDraft(event.target.value as Form1823Record["status"])}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="pending">Pending</option>
                        <option value="received">Received</option>
                        <option value="expired">Expired</option>
                        <option value="renewal_due">Renewal due</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Physician name</span>
                      <input
                        type="text"
                        value={form1823PhysicianDraft}
                        onChange={(event) => setForm1823PhysicianDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exam date</span>
                      <input
                        type="date"
                        value={form1823ExamDateDraft}
                        onChange={(event) => setForm1823ExamDateDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expiration date</span>
                      <input
                        type="date"
                        value={form1823ExpirationDraft}
                        onChange={(event) => setForm1823ExpirationDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Checklist notes</span>
                    <textarea
                      value={form1823NotesDraft}
                      onChange={(event) => setForm1823NotesDraft(event.target.value)}
                      rows={3}
                      className="w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div>
                      Latest record updated: {form1823Record ? formatTs(form1823Record.updated_at) : "—"}
                      {" · "}
                      Checklist received: {form1823ChecklistItem?.received_at ? formatTs(form1823ChecklistItem.received_at) : "—"}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={actionLoading === "form-1823"}
                      onClick={() => void saveForm1823()}
                    >
                      {actionLoading === "form-1823" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Form 1823"}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <select
                    value={bedDraft}
                    onChange={(event) => setBedDraft(event.target.value)}
                    className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">No bed assigned</option>
                    {row.bed_id && row.beds?.bed_label ? (
                      <option value={row.bed_id}>{row.beds.bed_label} (current)</option>
                    ) : null}
                    {beds
                      .filter((bed) => bed.id !== row.bed_id)
                      .map((bed) => (
                        <option key={bed.id} value={bed.id}>
                          {bed.bed_label}
                        </option>
                      ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={bedDraft === (row.bed_id ?? "") || !!actionLoading}
                    onClick={() => void updateCase({ bed_id: bedDraft || null }, bedDraft ? "Bed assignment saved." : "Bed assignment cleared.")}
                  >
                    {actionLoading === "Bed assignment saved." || actionLoading === "Bed assignment cleared."
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : "Save bed"}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    type="date"
                    value={targetMoveInDraft}
                      onChange={(event) => setTargetMoveInDraft(event.target.value)}
                      className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!targetMoveInDraft || targetMoveInDraft === (row.target_move_in_date ?? "") || !!actionLoading}
                      onClick={() => void updateCase({ target_move_in_date: targetMoveInDraft }, "Target move-in date saved.")}
                    >
                      {actionLoading === "Target move-in date saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save move-in date"}
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canReserveBed || row.status === "bed_reserved" || row.status === "move_in" || !!actionLoading}
                      onClick={() => void updateCase({ status: "bed_reserved" }, "Case advanced to bed reserved.")}
                    >
                      {actionLoading === "Case advanced to bed reserved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Advance to bed reserved"}
                    </Button>
                    <Button
                      type="button"
                      disabled={!canAdvanceMoveIn || row.status === "move_in" || !!actionLoading}
                      onClick={() => void updateCase({ status: "move_in" }, "Case advanced to move-in.")}
                    >
                      {actionLoading === "Case advanced to move-in." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Advance to move-in"}
                    </Button>
                  </div>
                </div>
                <div className="mt-5 rounded-[8px] border border-info/20 bg-info/10 p-4 space-y-3">
                  <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Downstream onboarding work</p>
                  {row.status !== "move_in" ? (
                    <p className="text-sm text-foreground">
                      Advance this case to <span className="font-semibold">move in</span> before completing downstream onboarding work across resident, care plan, medications, billing, and family coordination.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {onboarding.map((item) => (
                          <div key={item.key} className="rounded-[8px] border border-border bg-card px-4 py-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">{item.label}</span>
                            <span className={cn(
                              "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                              item.passed
                                ? "bg-success/10 text-success"
                                : "bg-warning/10 text-warning",
                            )}>
                              {item.passed ? "Complete" : "Missing"}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="grid gap-2">
                        {onboardingLinks(row.resident_id).map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="rounded-[8px] border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                          >
                            {item.label}
                          </Link>
                        ))}
                        <Link
                          href="/admin/admissions/onboarding"
                          className="rounded-[8px] border border-info/20 bg-info/10 px-4 py-3 text-sm font-medium text-info transition-colors hover:bg-info/20"
                        >
                          Open onboarding queue
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </RecordDetailSection>

              <RecordDetailSection title="Quoted Rate Terms" description="Saved in admission_case_rate_terms">
                <div className="mb-6 rounded-[8px] border border-border bg-card p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
                      {editingRateTermId ? "Edit quoted terms" : "Add quoted terms"}
                    </p>
                    {editingRateTermId ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => clearRateTermForm()}>
                        Cancel edit
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Rate schedule</label>
                      <select
                        value={rateScheduleDraft}
                        onChange={(event) => setRateScheduleDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Manual quote</option>
                        {rateSchedules.map((schedule) => (
                          <option key={schedule.id} value={schedule.id}>
                            {schedule.name} · {schedule.effective_date}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Accommodation</label>
                      <select
                        value={rateAccommodationDraft}
                        onChange={(event) => setRateAccommodationDraft(event.target.value as Database["public"]["Enums"]["admission_accommodation_quote"])}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="private">{formatColLabel("private")}</option>
                        <option value="semi_private">{formatColLabel("semi_private")}</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Care level helper</label>
                      <select
                        value={rateCareLevelDraft}
                        onChange={(event) => setRateCareLevelDraft(event.target.value as "1" | "2" | "3")}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="1">Level 1</option>
                        <option value="2">Level 2</option>
                        <option value="3">Level 3</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!selectedRateSchedule}
                        onClick={() => prefillQuotedTermsFromSchedule()}
                      >
                        Prefill from schedule
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Quoted base rate (cents)</label>
                      <input
                        type="number"
                        min="0"
                        value={quotedBaseDraft}
                        onChange={(event) => setQuotedBaseDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Quoted care surcharge (cents)</label>
                      <input
                        type="number"
                        min="0"
                        value={quotedCareDraft}
                        onChange={(event) => setQuotedCareDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Effective date</label>
                      <input
                        type="date"
                        value={effectiveDateDraft}
                        onChange={(event) => setEffectiveDateDraft(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  {selectedRateSchedule ? (
                    <div className="rounded-[8px] border border-info/20 bg-info/10 px-4 py-3 text-xs text-info">
                      Schedule helper:
                      <span className="ml-2 font-medium">{formatColLabel("private")} {formatCents(selectedRateSchedule.base_rate_private)}</span>
                      <span className="ml-2 font-medium">{formatColLabel("semi_private")} {formatCents(selectedRateSchedule.base_rate_semi_private)}</span>
                      <span className="ml-2 font-medium">L1 {formatCents(selectedRateSchedule.care_surcharge_level_1)}</span>
                      <span className="ml-2 font-medium">L2 {formatCents(selectedRateSchedule.care_surcharge_level_2)}</span>
                      <span className="ml-2 font-medium">L3 {formatCents(selectedRateSchedule.care_surcharge_level_3)}</span>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</label>
                    <textarea
                      value={rateNotesDraft}
                      onChange={(event) => setRateNotesDraft(event.target.value)}
                      rows={3}
                      className="w-full rounded-[8px] border border-border bg-background px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      disabled={actionLoading === "rate-term" || quotedBaseDraft.trim() === ""}
                      onClick={() => void addRateTerm()}
                    >
                      {actionLoading === "rate-term"
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : editingRateTermId
                          ? "Update quoted terms"
                          : "Save quoted terms"}
                    </Button>
                  </div>
                </div>

                <div className="relative z-10 w-full overflow-hidden">
                   {rateTerms.length === 0 ? (
                     <p className="text-sm text-muted-foreground py-4 font-medium px-2">No rate quotes recorded.</p>
                   ) : (
                     <>
                        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 px-6 pb-4 border-b border-border relative z-10 text-left">
                           <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Accommodation</div>
                           <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Base (¢)</div>
                           <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Care (¢)</div>
                           <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Effective</div>
                        </div>

                        <div className="space-y-3 mt-6 relative z-10">
                           <MotionList className="space-y-3">
                              {rateTerms.map((t) => (
                                 <MotionItem key={t.id}>
                                    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 sm:items-center p-5 rounded-[8px] bg-card border border-border tap-responsive w-full outline-none">
                                      <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Accommodation</span>
                                         <span className="font-semibold text-base text-foreground tracking-tight leading-tight">{formatColLabel(t.accommodation_type)}</span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Base (¢)</span>
                                         <span className="text-sm tabular-nums text-foreground">{formatCents(t.quoted_base_rate_cents)}</span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Care (¢)</span>
                                         <span className="text-sm tabular-nums text-foreground">{formatCents(t.quoted_care_surcharge_cents)}</span>
                                      </div>
                                     <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">Effective</span>
                                         <span className="text-sm font-medium text-foreground flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> {t.effective_date ?? "—"}</span>
                                      </div>
                                      <div className="sm:col-span-4 flex justify-end">
                                        <Button type="button" variant="outline" size="sm" onClick={() => startEditingRateTerm(t)}>
                                          Edit terms
                                        </Button>
                                      </div>
                                    </div>
                                 </MotionItem>
                              ))}
                           </MotionList>
                        </div>
                     </>
                   )}
                </div>
              </RecordDetailSection>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
