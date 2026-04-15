"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, FileText, Loader2, UserPlus } from "lucide-react";

import { AdmissionsHubNav } from "../admissions-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { useHavenAuth } from "@/contexts/haven-auth-context";

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

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [targetMoveInDraft, setTargetMoveInDraft] = useState("");
  const [bedDraft, setBedDraft] = useState("");
  const [physicianOrdersSummaryDraft, setPhysicianOrdersSummaryDraft] = useState("");
  const [caseNotesDraft, setCaseNotesDraft] = useState("");
  const [rateScheduleDraft, setRateScheduleDraft] = useState("");
  const [rateAccommodationDraft, setRateAccommodationDraft] =
    useState<Database["public"]["Enums"]["admission_accommodation_quote"]>("private");
  const [rateCareLevelDraft, setRateCareLevelDraft] = useState<"1" | "2" | "3">("2");
  const [quotedBaseDraft, setQuotedBaseDraft] = useState("");
  const [quotedCareDraft, setQuotedCareDraft] = useState("");
  const [effectiveDateDraft, setEffectiveDateDraft] = useState("");
  const [rateNotesDraft, setRateNotesDraft] = useState("");
  const [editingRateTermId, setEditingRateTermId] = useState<string | null>(null);

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
        const [carePlansRes, medsRes, payersRes, consentsRes] = await Promise.all([
          supabase.from("care_plans").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase.from("resident_medications").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase.from("resident_payers").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
          supabase.from("family_consent_records").select("id", { count: "exact", head: true }).eq("resident_id", caseRow.resident_id).is("deleted_at", null),
        ]);
        setOnboardingCounts({
          carePlans: carePlansRes.count ?? 0,
          medications: medsRes.count ?? 0,
          payers: payersRes.count ?? 0,
          familyConsents: consentsRes.count ?? 0,
        });
      } else {
        setOnboardingCounts({ carePlans: 0, medications: 0, payers: 0, familyConsents: 0 });
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
      const { error: updateError } = await supabase
        .from("admission_cases")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update admission case.");
    } finally {
      setActionLoading(null);
    }
  }

  const readiness = row ? admissionReadinessChecklist(row, rateTerms) : [];
  const canReserveBed = Boolean(row?.financial_clearance_at && row?.physician_orders_received_at && row?.bed_id);
  const canAdvanceMoveIn = Boolean(canReserveBed && row?.target_move_in_date && rateTerms.length > 0);
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
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <AdmissionsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href="/admin/admissions"
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO ADMISSIONS
             </Link>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Admission Case
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Operational workspace for move-in readiness, quoted terms, and downstream onboarding.
            </p>
          </div>
          <div>
            {row?.resident_id && (
              <Link
                href={`/admin/residents/${row.resident_id}`}
                className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-brand-600 hover:bg-brand-700 text-white shadow-lg flex items-center gap-2")}
              >
                Resident Profile
              </Link>
            )}
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center p-12 text-sm text-slate-500 font-medium bg-white/50 dark:bg-white/5 rounded-[2.5rem] border border-slate-200/50 dark:border-white/10 backdrop-blur-3xl">
             <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Case...
          </div>
        ) : error ? (
           <div className="p-6 rounded-[2.5rem] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-medium">
              {error}
           </div>
        ) : !row ? (
          <div className="flex items-center justify-center p-12 text-center text-sm text-slate-500 bg-white/50 dark:bg-white/5 rounded-[2.5rem] border border-slate-200/50 dark:border-white/10 backdrop-blur-3xl">
            No case found for this id, or you do not have access.
          </div>
        ) : (
          <>
            {actionError ? (
              <div className="p-6 rounded-[2.5rem] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-medium text-sm">
                {actionError}
              </div>
            ) : null}
            {actionMessage ? (
              <div className="p-6 rounded-[2.5rem] bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium text-sm">
                {actionMessage}
              </div>
            ) : null}
            {wrongFacility && (
              <div className="p-6 rounded-[2.5rem] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 font-medium text-sm">
                This case belongs to another facility. Switch the facility in the header to match.
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all h-fit">
                <div className="mb-8 border-b border-slate-200 dark:border-white/5 pb-4 flex flex-col gap-2">
                   <h3 className="text-2xl font-display font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                     <UserPlus className="h-6 w-6 text-brand-500" />
                     {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident"}
                   </h3>
                   <p className="font-mono text-xs break-all text-slate-500 dark:text-slate-400">{row.id}</p>
                </div>
                
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Status</dt>
                    <dd className="text-base font-semibold text-slate-900 dark:text-slate-100 capitalize">{formatStatus(row.status)}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Target Move-In</dt>
                    <dd className="text-base font-semibold text-slate-900 dark:text-slate-100">{row.target_move_in_date ?? "—"}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Referral Lead</dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {row.referral_leads ? `${row.referral_leads.first_name} ${row.referral_leads.last_name}` : "—"}
                    </dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Bed</dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.beds?.bed_label ?? "—"}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Financial Clearance</dt>
                    <dd className="text-sm font-mono text-slate-900 dark:text-slate-300">{formatTs(row.financial_clearance_at)}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Physician Orders</dt>
                    <dd className="text-sm font-mono text-slate-900 dark:text-slate-300">{formatTs(row.physician_orders_received_at)}</dd>
                  </div>
                  <div className="sm:col-span-2 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Physician Orders Summary</dt>
                    <dd className="space-y-3">
                      <textarea
                        value={physicianOrdersSummaryDraft}
                        onChange={(event) => setPhysicianOrdersSummaryDraft(event.target.value)}
                        rows={4}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <div className="sm:col-span-2 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Notes</dt>
                    <dd className="space-y-3">
                      <textarea
                        value={caseNotesDraft}
                        onChange={(event) => setCaseNotesDraft(event.target.value)}
                        rows={4}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <div className="sm:col-span-2 flex items-center justify-end text-[10px] text-slate-400 uppercase tracking-widest font-mono mt-2">
                    Updated: {formatTs(row.updated_at)}
                  </div>
                </dl>
              </div>

              <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 backdrop-blur-3xl shadow-sm relative overflow-hidden h-fit">
                <div className="mb-6 border-b border-amber-200/70 dark:border-amber-900/40 pb-4 flex items-center justify-between">
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Move-In Readiness</h3>
                  <span className="text-[10px] font-mono tracking-widest text-amber-700 dark:text-amber-300 uppercase">Operational checklist</span>
                </div>
                <div className="space-y-3">
                  {readiness.map((item) => (
                    <div key={item.key} className="rounded-2xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
                      <span className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest",
                        item.passed
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      )}>
                        {item.passed ? "Complete" : "Missing"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-2xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 p-4">
                  <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mb-2">Next actions</p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {!row.financial_clearance_at ? <li>Record financial clearance before move-in.</li> : null}
                    {!row.physician_orders_received_at ? <li>Capture physician orders receipt before move-in.</li> : null}
                    {!row.bed_id ? <li>Reserve or assign a bed.</li> : null}
                    {!row.target_move_in_date ? <li>Set a target move-in date.</li> : null}
                    {rateTerms.length === 0 ? <li>Add quoted rate terms for the admission package.</li> : null}
                    {row.financial_clearance_at && row.physician_orders_received_at && row.bed_id && row.target_move_in_date && rateTerms.length > 0 ? (
                      <li>Core readiness items are in place. Advance this case through the move-in workflow.</li>
                    ) : null}
                  </ul>
                </div>
                <div className="mt-5 rounded-2xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 p-4 space-y-4">
                  <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500">Workflow actions</p>
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
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <select
                    value={bedDraft}
                    onChange={(event) => setBedDraft(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                <div className="mt-5 rounded-2xl border border-indigo-200/70 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
                  <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500">Downstream onboarding work</p>
                  {row.status !== "move_in" ? (
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      Advance this case to <span className="font-semibold">move in</span> before completing downstream onboarding work across resident, care plan, medications, billing, and family coordination.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {onboarding.map((item) => (
                          <div key={item.key} className="rounded-xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 px-4 py-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
                            <span className={cn(
                              "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest",
                              item.passed
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
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
                            className="rounded-xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 px-4 py-3 text-sm font-medium text-slate-900 dark:text-white transition-colors hover:bg-white dark:hover:bg-black/30"
                          >
                            {item.label}
                          </Link>
                        ))}
                        <Link
                          href="/admin/admissions/onboarding"
                          className="rounded-xl border border-indigo-200/70 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3 text-sm font-medium text-indigo-900 dark:text-indigo-100 transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                        >
                          Open onboarding queue
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative h-fit">
                <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                     <FileText className="h-5 w-5 text-indigo-500" /> Quoted Rate Terms
                  </h3>
                  <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Saved in admission_case_rate_terms</p>
                </div>

                <div className="mb-6 rounded-2xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500">
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
                      <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Rate schedule</label>
                      <select
                        value={rateScheduleDraft}
                        onChange={(event) => setRateScheduleDraft(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Accommodation</label>
                      <select
                        value={rateAccommodationDraft}
                        onChange={(event) => setRateAccommodationDraft(event.target.value as Database["public"]["Enums"]["admission_accommodation_quote"])}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="private">Private</option>
                        <option value="semi_private">Semi-private</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Care level helper</label>
                      <select
                        value={rateCareLevelDraft}
                        onChange={(event) => setRateCareLevelDraft(event.target.value as "1" | "2" | "3")}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Quoted base rate (cents)</label>
                      <input
                        type="number"
                        min="0"
                        value={quotedBaseDraft}
                        onChange={(event) => setQuotedBaseDraft(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Quoted care surcharge (cents)</label>
                      <input
                        type="number"
                        min="0"
                        value={quotedCareDraft}
                        onChange={(event) => setQuotedCareDraft(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Effective date</label>
                      <input
                        type="date"
                        value={effectiveDateDraft}
                        onChange={(event) => setEffectiveDateDraft(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  {selectedRateSchedule ? (
                    <div className="rounded-xl border border-indigo-200/70 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3 text-xs text-indigo-900 dark:text-indigo-100">
                      Schedule helper:
                      <span className="ml-2 font-medium">Private {formatCents(selectedRateSchedule.base_rate_private)}</span>
                      <span className="ml-2 font-medium">Semi-private {formatCents(selectedRateSchedule.base_rate_semi_private)}</span>
                      <span className="ml-2 font-medium">L1 {formatCents(selectedRateSchedule.care_surcharge_level_1)}</span>
                      <span className="ml-2 font-medium">L2 {formatCents(selectedRateSchedule.care_surcharge_level_2)}</span>
                      <span className="ml-2 font-medium">L3 {formatCents(selectedRateSchedule.care_surcharge_level_3)}</span>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Notes</label>
                    <textarea
                      value={rateNotesDraft}
                      onChange={(event) => setRateNotesDraft(event.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                     <p className="text-sm text-slate-500 dark:text-slate-400 py-4 font-medium px-2">No rate quotes recorded.</p>
                   ) : (
                     <>
                        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Accommodation</div>
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Base (¢)</div>
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Care (¢)</div>
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Effective</div>
                        </div>

                        <div className="space-y-3 mt-6 relative z-10">
                           <MotionList className="space-y-3">
                              {rateTerms.map((t) => (
                                 <MotionItem key={t.id}>
                                    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                      <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Accommodation</span>
                                         <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight leading-tight capitalize">{t.accommodation_type.replace("_", " ")}</span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Base (¢)</span>
                                         <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{formatCents(t.quoted_base_rate_cents)}</span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Care (¢)</span>
                                         <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{formatCents(t.quoted_care_surcharge_cents)}</span>
                                      </div>
                                     <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Effective</span>
                                         <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-slate-400" /> {t.effective_date ?? "—"}</span>
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
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
