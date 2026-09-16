"use client";
import { CarePlanAcknowledgements } from "@/components/care-plans/CarePlanAcknowledgements";
import { CARE_PLAN_AUTHOR_ROLES, CarePlanAuthor } from "@/components/care-plans/CarePlanAuthor";
import { CarePlanDiffModal } from "@/components/care-plans/care-plan-diff-modal";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Brain, CalendarClock, GitCompareArrows, Printer } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  formatCarePlanDateOnly,
  formatCarePlanItemDescription,
  formatCarePlanItemTitle,
  formatCarePlanResidentName,
  formatCarePlanVersion,
} from "@/lib/care-plans/care-plan-display-copy";
import {
  CARE_PLAN_FORM_1823_RELATION_COPY,
  CARE_PLAN_PENDING_REVIEW_COPY,
  describeCarePlanState,
  easternTodayIso,
  formatCarePlanAssistance,
  formatCarePlanCategory,
  formatCarePlanStatusLabel,
  reviewDueSignal,
} from "@/lib/care-plans/care-plan-editor-state";
import { formatCarePlanPrintAction, formatCarePlanPrintTimestamp } from "@/lib/care-plans/care-plan-print-copy";
import {
  CARE_PLAN_APPROVAL_RATE_COPY,
  CARE_PLAN_AUTHOR_CANNOT_APPROVE_COPY,
  formatCarePlanAcuityLabel,
  isCarePlanAuthor,
} from "@/lib/care-plans/care-plan-approval-copy";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { Form1823DraftSource } from "@/lib/care-plans/draft-from-form-1823";
import { ALIGNMENT_STATE_LABELS, alignForm1823WithPlan, type AlignmentState } from "@/lib/care-plans/form-1823-alignment";
import { formatMedicationSystemOfRecord, medicationSystemOfRecordFromSettings, type MedicationSystemOfRecord } from "@/lib/admin/facilities/medication-system-of-record";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

type ResidentMini = {
  id: string;
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string | null;
};

type CarePlanRow = {
  id: string;
  version: number | null;
  status: string | null;
  effective_date: string | null;
  review_due_date: string | null;
  notes: string | null;
  updated_at: string | null;
  created_at: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  previous_version_id: string | null;
  source_form_1823_id: string | null;
};

type Form1823Row = Form1823DraftSource & { is_current: boolean; status: string | null };

const FORM_1823_COLUMNS =
  "id, exam_date, physician_name, examiner_title, allergies, prescribed_diet, medication_assistance, elopement_risk, adl_bathing, adl_dressing, adl_eating, adl_transferring, adl_toileting, adl_grooming, adl_walking, condition_pressure_injury, physical_limitations, cognitive_behavioral_status, service_requirements, precautions, is_current, status";

const CARE_PLAN_COLUMNS =
  "id, version, status, effective_date, review_due_date, notes, updated_at, created_at, created_by, approved_by, approved_at, previous_version_id, source_form_1823_id";

const ITEM_COLUMNS = "id, category, title, description, assistance_level, frequency, special_instructions, goal, interventions, sort_order";

type CarePlanItemRow = {
  id: string;
  category: string | null;
  title: string | null;
  description: string | null;
  assistance_level: string | null;
  frequency: string | null;
  special_instructions: string | null;
  goal: string | null;
  interventions: string[] | null;
  sort_order: number | null;
};

type LoadedState = {
  residentName: string;
  residentAcuity: string | null;
  facilityName: string | null;
  /** Every non-deleted version, newest first. */
  plans: CarePlanRow[];
  /** The version being read on the page. */
  plan: CarePlanRow | null;
  items: CarePlanItemRow[];
  /** Lines of the active plan — what a revision starts from — when the read version is not the active one. */
  activeItems: CarePlanItemRow[];
  /** `user_profiles.full_name` by user id for drafted-by / signed-by lines. */
  names: Map<string, string>;
  /** The resident's current, received Form 1823 — the one a draft may start from. */
  currentForm1823: Form1823Row | null;
  /** The 1823 the shown plan was drafted from, if it named one. */
  sourceForm1823: Form1823Row | null;
  /** Where this facility's medication orders live (COL-389); null when not set. */
  medicationSystem: MedicationSystemOfRecord | null;
};

const APPROVER_ROLES = CARE_PLAN_AUTHOR_ROLES;

export default function AdminResidentCarePlanPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();
  const { user, appRole } = useHavenAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [signingOpen, setSigningOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [comparePlanId, setComparePlanId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setLoaded(null);

    if (!residentId || !UUID_STRING_RE.test(residentId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const resResult = (await supabase
        .from("residents" as never)
        .select("id, facility_id, first_name, last_name, acuity_level")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<ResidentMini>;

      if (resResult.error) throw resResult.error;
      const resident = resResult.data;
      if (!resident) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      if (isValidFacilityIdForQuery(selectedFacilityId) && resident.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const residentName = formatCarePlanResidentName({
        first_name: resident.first_name,
        last_name: resident.last_name,
      });

      const [plansResult, formsResult, facilityResult] = (await Promise.all([
        supabase
          .from("care_plans" as never)
          .select(CARE_PLAN_COLUMNS)
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .order("version", { ascending: false }),
        supabase
          .from("form_1823_records" as never)
          .select(FORM_1823_COLUMNS)
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .order("exam_date", { ascending: false, nullsFirst: false }),
        supabase.from("facilities" as never).select("name, settings").eq("id", resident.facility_id).maybeSingle(),
      ])) as unknown as [QueryListResult<CarePlanRow>, QueryListResult<Form1823Row>, QueryResult<{ name: string | null; settings: unknown }>];

      if (plansResult.error) throw plansResult.error;
      if (formsResult.error) throw formsResult.error;
      if (facilityResult.error) throw facilityResult.error;
      const medicationSystem = medicationSystemOfRecordFromSettings(facilityResult.data?.settings);
      const facilityName = facilityResult.data?.name?.trim() || null;
      const plans = plansResult.data ?? [];
      const forms = formsResult.data ?? [];
      const currentForm1823 = forms.find((form) => form.is_current && form.status === "received") ?? null;
      const state = describeCarePlanState(plans);
      // Read the version a reviewer needs first: the one awaiting review, else the plan in force.
      const plan = plans.find((candidate) => candidate.id === selectedPlanId) ?? state.pending ?? state.active ?? plans[0] ?? null;

      const userIds = [...new Set(plans.flatMap((row) => [row.created_by, row.approved_by]).filter((id): id is string => Boolean(id)))];
      const names = new Map<string, string>();
      if (userIds.length > 0) {
        const profilesResult = (await supabase
          .from("user_profiles" as never)
          .select("id, full_name")
          .in("id", userIds)) as unknown as QueryListResult<{ id: string; full_name: string | null }>;
        if (!profilesResult.error) {
          for (const profile of profilesResult.data ?? []) names.set(profile.id, formatUploadedByProfile({ full_name: profile.full_name }));
        }
      }

      if (!plan) {
        setLoaded({ residentName, residentAcuity: resident.acuity_level, facilityName, plans, plan: null, items: [], activeItems: [], names, currentForm1823, sourceForm1823: null, medicationSystem });
        setLoading(false);
        return;
      }
      const sourceForm1823 = plan.source_form_1823_id ? forms.find((form) => form.id === plan.source_form_1823_id) ?? null : null;

      const loadItems = async (planId: string) => {
        const result = (await supabase
          .from("care_plan_items" as never)
          .select(ITEM_COLUMNS)
          .eq("care_plan_id", planId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true })) as unknown as QueryListResult<CarePlanItemRow>;
        if (result.error) throw result.error;
        return result.data ?? [];
      };
      const items = await loadItems(plan.id);
      const activeItems = state.active && state.active.id !== plan.id ? await loadItems(state.active.id) : state.active ? items : [];

      setLoaded({ residentName, residentAcuity: resident.acuity_level, facilityName, plans, plan, items, activeItems, names, currentForm1823, sourceForm1823, medicationSystem });
    } catch (err) {
      setError(
        formatLiveDataLoadError(err, "Care plan data is unavailable. Check your connection and try again."),
      );
    } finally {
      setLoading(false);
    }
  }, [residentId, selectedFacilityId, selectedPlanId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedItems = useMemo(() => groupByCategory(loaded?.items ?? []), [loaded?.items]);
  const state = useMemo(() => describeCarePlanState(loaded?.plans ?? []), [loaded?.plans]);

  const handleApprove = async () => {
    if (!signatureData || !plan?.id) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/care-plans/${plan.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signatureData }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to approve care plan");
      }

      await load();
      setSigningOpen(false);
      setSignatureData(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to approve care plan");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Resident roster
        </Link>
        <RecordDetailSection title="Resident not found">
          <p className="text-sm text-muted-foreground">
            This care plan route is tied to a resident record. Adjust your facility filter or return to the
            resident roster.
          </p>
        </RecordDetailSection>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!loaded) {
    return null;
  }

  const { residentName, facilityName, plan, items, names } = loaded;
  // A recorded user whose profile this role cannot read is still a person, not a missing value.
  const nameFor = (id: string | null | undefined) => (id ? names.get(id) ?? "another staff member" : null);
  const today = easternTodayIso();
  const activeSignal = state.active ? reviewDueSignal(state.active.review_due_date, today) : { kind: "none" as const };
  const canDraft = APPROVER_ROLES.includes(appRole as (typeof APPROVER_ROLES)[number]);
  const viewingIsPending = plan != null && state.pending?.id === plan.id;
  const viewerIsAuthor = plan ? isCarePlanAuthor(plan.created_by, user?.id) : false;
  const editorItems = state.active ? loaded.activeItems : [];

  return (
    <div className="relative w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in duration-[var(--motion-duration)] ease-[var(--motion-ease)]">

        <RecordDetailHeader
          title="Care plan"
          subtitle={[residentName, facilityName ?? "Facility not recorded"].join(" · ")}
        />

        <RecordDetailSection
          title="Current plan"
          description="What is in force, and what is waiting on a reviewer"
          action={
            state.active ? (
              <Link
                href={`/print/care-plans/${state.active.id}`}
                target="_blank"
                rel="noopener"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex gap-1")}
              >
                <Printer className="h-4 w-4" />
                Print active plan
              </Link>
            ) : null
          }
        >
          <dl className="space-y-3 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <dt className="min-w-[9rem] text-[12px] font-medium text-muted-foreground">Active plan</dt>
              <dd className="min-w-0 text-foreground">
                {state.active ? (
                  <div className="space-y-1">
                    <p>
                      <span className="font-medium">{formatCarePlanVersion(state.active.version)}</span> · effective{" "}
                      <span className="tabular-nums">{formatCarePlanDateOnly(state.active.effective_date)}</span>
                      {state.active.approved_at ? (
                        <>
                          {" "}· signed by {nameFor(state.active.approved_by)} on{" "}
                          <span className="tabular-nums">{formatCarePlanPrintTimestamp(state.active.approved_at)}</span>
                        </>
                      ) : null}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {activeSignal.kind === "overdue" || activeSignal.kind === "dueToday" ? (
                        <StatusPill tone="danger" className="[&>span]:opacity-100 text-foreground">{activeSignal.label}</StatusPill>
                      ) : activeSignal.kind === "approaching" ? (
                        <StatusPill tone="warning" className="[&>span]:opacity-100 text-foreground">{activeSignal.label}</StatusPill>
                      ) : activeSignal.kind === "scheduled" ? (
                        <span className="text-[13px] text-muted-foreground">{activeSignal.label}</span>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">No review date posted</span>
                      )}
                      {activeSignal.kind === "overdue" || activeSignal.kind === "dueToday" || activeSignal.kind === "approaching" ? (
                        <Link href="/admin/care-plans/reviews-due" className="text-[13px] text-primary underline underline-offset-2">
                          Care plan reviews queue
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No active plan. Nothing is in force for this resident.</p>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <dt className="min-w-[9rem] text-[12px] font-medium text-muted-foreground">Awaiting review</dt>
              <dd className="min-w-0 text-foreground">
                {state.pending ? (
                  <div className="space-y-2">
                    <p>
                      <span className="font-medium">{formatCarePlanVersion(state.pending.version)}</span> · {formatCarePlanStatusLabel(state.pending.status).toLowerCase()} · saved by{" "}
                      {nameFor(state.pending.created_by)} on <span className="tabular-nums">{formatCarePlanPrintTimestamp(state.pending.created_at)}</span>
                      {state.active ? ` · ${formatCarePlanVersion(state.active.version)} stays in effect until this is signed` : " · nothing is in force until this is signed"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {canDraft ? (
                        isCarePlanAuthor(state.pending.created_by, user?.id) ? (
                          <p className="text-[13px] text-muted-foreground">{CARE_PLAN_AUTHOR_CANNOT_APPROVE_COPY}</p>
                        ) : (
                          <Button size="sm" onClick={() => { setSelectedPlanId(state.pending!.id); setSigningOpen(true); }}>
                            Review &amp; sign {formatCarePlanVersion(state.pending.version)}
                          </Button>
                        )
                      ) : null}
                      {plan?.id !== state.pending.id ? (
                        <Button size="sm" variant="outline" onClick={() => setSelectedPlanId(state.pending!.id)}>
                          Read {formatCarePlanVersion(state.pending.version)}
                        </Button>
                      ) : null}
                      {state.pending.previous_version_id ? (
                        <Button size="sm" variant="outline" onClick={() => setComparePlanId(state.pending!.id)}>
                          <GitCompareArrows aria-hidden /> What changed
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Nothing awaiting review.</p>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <dt className="min-w-[9rem] text-[12px] font-medium text-muted-foreground">Who may act</dt>
              <dd className="min-w-0 text-[13px] text-muted-foreground">
                Owners, org admins, facility admins and nurses draft and sign. The person who saved a version cannot sign it.
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <dt className="min-w-[9rem] text-[12px] font-medium text-muted-foreground">Form 1823</dt>
              <dd className="min-w-0 text-[13px] text-muted-foreground">
                {CARE_PLAN_FORM_1823_RELATION_COPY}{" "}
                {loaded.currentForm1823
                  ? `Current exam ${formatCarePlanDateOnly(loaded.currentForm1823.exam_date)} on file.`
                  : "No current Form 1823 on file for this resident."}{" "}
                <Link href="/admin/care-plans/form-1823-alignment" className="text-primary underline underline-offset-2">
                  Form 1823 alignment
                </Link>
              </dd>
            </div>
          </dl>
        </RecordDetailSection>

        {state.mode === "pending" ? (
          canDraft ? <p className="text-sm text-muted-foreground">{CARE_PLAN_PENDING_REVIEW_COPY}</p> : null
        ) : (
          <CarePlanAuthor
            key={`${residentId}:${state.active?.id ?? "new"}`}
            residentId={residentId}
            residentName={residentName}
            facilityName={facilityName}
            mode={state.mode}
            previous={state.active}
            initialItems={editorItems}
            sourceForm1823={loaded.currentForm1823}
            medicationSystemLabel={loaded.medicationSystem?.label ?? null}
            onSaved={() => { setSelectedPlanId(""); void load(); }}
          />
        )}

        {!plan ? (
          <AdminEmptyState
            title="No care plan on file"
            description={canDraft ? "Start the first version above. It takes effect once another authorized reviewer signs it." : "When an authorized author saves a version, it appears here for review."}
          />
        ) : (
          <div className="space-y-6">

            <RecordDetailSection
              title={`Reading ${formatCarePlanVersion(plan.version)} · ${formatCarePlanStatusLabel(plan.status)}`}
              description={
                viewingIsPending
                  ? "This version is not in effect until signed."
                  : plan.status === "archived"
                    ? "This version was replaced; shown for the record."
                    : "The plan in force."
              }
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {viewingIsPending && canDraft && !viewerIsAuthor ? (
                    <Button size="sm" onClick={() => setSigningOpen(true)}>Review &amp; sign</Button>
                  ) : null}
                  {plan.previous_version_id ? (
                    <Button size="sm" variant="outline" onClick={() => setComparePlanId(plan.id)}>
                      <GitCompareArrows aria-hidden /> Compare with previous
                    </Button>
                  ) : null}
                  <Link
                    href={`/print/care-plans/${plan.id}`}
                    target="_blank"
                    rel="noopener"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex gap-1")}
                  >
                    <Printer className="h-4 w-4" />
                    {formatCarePlanPrintAction(plan.status)}
                  </Link>
                </div>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-2">
                    <CalendarClock className="w-3.5 h-3.5" /> Effective date
                  </p>
                  <p className="tabular-nums text-base font-medium text-foreground">
                    {formatCarePlanDateOnly(plan.effective_date)}
                  </p>
                </div>
                <div className="bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-2">
                    <CalendarClock className="w-3.5 h-3.5" /> Review due
                  </p>
                  <p className="tabular-nums text-base font-medium text-foreground">
                    {formatCarePlanDateOnly(plan.review_due_date)}
                  </p>
                </div>
                <div className="bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Medication orders</p>
                  <p className="text-sm font-medium text-foreground">{formatMedicationSystemOfRecord(loaded.medicationSystem)}</p>
                </div>
                <div className="sm:col-span-2 lg:col-span-3 bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Attribution</p>
                  <p className="text-sm text-foreground">
                    Drafted by {nameFor(plan.created_by) ?? "no recorded author"} on <span className="tabular-nums">{formatCarePlanPrintTimestamp(plan.created_at)}</span>
                    {plan.approved_at ? (
                      <>
                        {" "}· signed by {nameFor(plan.approved_by) ?? "no recorded approver"} on <span className="tabular-nums">{formatCarePlanPrintTimestamp(plan.approved_at)}</span>
                      </>
                    ) : (
                      " · not signed"
                    )}
                  </p>
                  {loaded.sourceForm1823 ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Drafted from Form 1823 exam {formatCarePlanDateOnly(loaded.sourceForm1823.exam_date)}
                      {loaded.sourceForm1823.physician_name ? ` · ${loaded.sourceForm1823.physician_name}` : ""}
                      {loaded.currentForm1823 && loaded.currentForm1823.id !== loaded.sourceForm1823.id
                        ? ` — a newer Form 1823 (exam ${formatCarePlanDateOnly(loaded.currentForm1823.exam_date)}) is on file`
                        : ""}
                    </p>
                  ) : null}
                </div>
                {plan.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3 bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Documentation notes</p>
                    <p className="text-sm font-medium text-foreground">{plan.notes}</p>
                  </div>
                ) : null}
              </div>
            </RecordDetailSection>

            {items.length === 0 ? (
              <AdminEmptyState
                title="No active needs on this version"
                description="A version with no needs cannot be signed. Needs and interventions list ADLs, safety measures, and other ordered protocols."
              />
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {Array.from(groupedItems.entries()).map(([category, rows]) => (
                  <RecordDetailSection
                    key={category}
                    title={formatCarePlanCategory(category)}
                    description={`${rows.length} need${rows.length > 1 ? "s" : ""}`}
                  >
                    <MotionList className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {rows.map((row) => (
                        <MotionItem key={row.id}>
                          <div className="group flex flex-col h-full justify-between p-[14px] rounded-[8px] border border-border bg-card shadow-[var(--shadow-card)] transition-all duration-[var(--motion-duration)] outline-none relative overflow-hidden focus-within:ring-2 focus-within:ring-ring hover:border-primary/20 hover:-translate-y-0.5">
                            <div className="space-y-4 relative z-10">
                              <div className="flex items-start justify-between gap-3">
                                <h4 className="font-semibold text-foreground leading-tight pr-4">
                                  {formatCarePlanItemTitle(row.title)}
                                </h4>
                                {row.assistance_level ? (
                                  <Badge className="bg-muted text-muted-foreground border-border uppercase tracking-wider text-[9px] font-bold px-2.5 py-0.5 shadow-none whitespace-nowrap">
                                    {formatCarePlanAssistance(row.assistance_level)}
                                  </Badge>
                                ) : null}
                              </div>

                              <p className="text-sm font-medium text-muted-foreground">
                                {formatCarePlanItemDescription(row.description)}
                              </p>

                              {row.frequency && (
                                <div className="pt-2">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1">Frequency</span>
                                  <span className="tabular-nums text-sm bg-muted px-2 py-1 rounded inline-block text-foreground border border-border">
                                    {row.frequency}
                                  </span>
                                </div>
                              )}

                              {row.interventions?.length ? (
                                <div className="pt-2">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1">Interventions</span>
                                  <ul className="space-y-1.5 w-full">
                                    {row.interventions.filter(Boolean).map((iv) => (
                                      <li key={iv} className="text-sm text-foreground flex items-start">
                                        <span className="text-primary mr-2 mt-0.5">•</span>
                                        <span className="flex-1">{iv}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {row.goal && (
                                <div className="pt-2">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1">Goal</span>
                                  <p className="text-sm text-primary font-medium">
                                    {row.goal}
                                  </p>
                                </div>
                              )}

                              {row.special_instructions && (
                                <div className="pt-4 mt-auto">
                                  <div className="rounded-[8px] border border-warning/30 bg-warning/10 p-[14px]">
                                    <span className="text-[11px] font-medium uppercase tracking-wider text-foreground block mb-1.5 flex items-center gap-1.5">
                                      <Brain className="w-3.5 h-3.5" /> Special instructions
                                    </span>
                                    <p className="text-xs font-medium text-foreground">
                                      {row.special_instructions}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </MotionItem>
                      ))}
                    </MotionList>
                  </RecordDetailSection>
                ))}
              </div>
            )}

            {loaded.currentForm1823 ? (
              <Form1823AlignmentSection form={loaded.currentForm1823} items={plan.status === "active" ? items : null} planStatus={plan.status} />
            ) : null}

            <CarePlanAcknowledgements key={plan.id} planId={plan.id} planStatus={plan.status} />

            <RecordDetailSection title="Versions" description="Every version on file, newest first. Replaced versions stay readable.">
              <ul className="divide-y divide-border">
                {loaded.plans.map((row) => {
                  const isReading = row.id === plan.id;
                  return (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="text-foreground">
                          <span className="font-medium">{formatCarePlanVersion(row.version)}</span> · {formatCarePlanStatusLabel(row.status)} · effective{" "}
                          <span className="tabular-nums">{formatCarePlanDateOnly(row.effective_date)}</span>
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          Drafted by {nameFor(row.created_by) ?? "no recorded author"}
                          {row.approved_at ? ` · signed by ${nameFor(row.approved_by) ?? "no recorded approver"} ${formatCarePlanPrintTimestamp(row.approved_at)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isReading ? (
                          <span className="text-[12px] text-muted-foreground">Reading</span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setSelectedPlanId(row.id)}>Read</Button>
                        )}
                        {row.previous_version_id ? (
                          <Button size="sm" variant="ghost" onClick={() => setComparePlanId(row.id)}>Compare</Button>
                        ) : null}
                        <Link
                          href={`/print/care-plans/${row.id}`}
                          target="_blank"
                          rel="noopener"
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
                        >
                          <Printer className="h-4 w-4" aria-hidden />
                          Print
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </RecordDetailSection>
          </div>
        )}
      </div>

      <CarePlanDiffModal carePlanId={comparePlanId} onClose={() => setComparePlanId(null)} onContinueToReview={(id) => setSelectedPlanId(id)} />

      {/* Signing Dialog */}
      <Dialog open={signingOpen} onOpenChange={setSigningOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve care plan</DialogTitle>
            <DialogDescription>
              Sign to approve this care plan and mark it as active. This action will be logged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {submitError && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-[8px] text-sm text-destructive">
                {submitError}
              </div>
            )}

            <div className="bg-muted rounded-[8px] p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Resident:</span>
                <span className="font-medium text-foreground">{residentName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Facility:</span>
                <span className="font-medium text-foreground">{facilityName ?? "Not recorded"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Version:</span>
                <span className="tabular-nums font-medium text-foreground">{formatCarePlanVersion(plan?.version)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Effective:</span>
                <span className="tabular-nums font-medium text-foreground">{formatCarePlanDateOnly(plan?.effective_date)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Acuity level:</span>
                <span className="font-medium text-foreground">{formatCarePlanAcuityLabel(loaded.residentAcuity)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{CARE_PLAN_APPROVAL_RATE_COPY}</p>

            <div>
              <label className="text-sm font-medium text-foreground block mb-3">
                Digital signature <span className="text-destructive">*</span>
              </label>
              <SignaturePad
                onSignatureChange={setSignatureData}
                height={150}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSigningOpen(false);
                setSignatureData(null);
                setSubmitError(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={!signatureData || isSubmitting}
            >
              {isSubmitting ? "Approving..." : "Confirm & approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ALIGNMENT_STATE_CLASS: Record<AlignmentState, string> = {
  addressed: "bg-success/10 text-success border-success/20",
  weaker: "bg-warning/10 text-warning border-warning/20",
  not_addressed: "bg-destructive/10 text-destructive border-destructive/30",
  not_assessed: "bg-muted text-muted-foreground border-border",
  no_plan: "bg-destructive/10 text-destructive border-destructive/30",
};

/**
 * What survey actually checks for a standard ALF licence: does what we do
 * match the 1823? Compared against the active plan only; a draft is not yet
 * what the facility does.
 */
function Form1823AlignmentSection({ form, items, planStatus }: { form: Form1823DraftSource; items: CarePlanItemRow[] | null; planStatus: string | null }) {
  const { rows, summary } = alignForm1823WithPlan(form, items);
  const description = summary.noPlan
    ? planStatus === "active"
      ? "No active plan"
      : `Compared against the active plan only — this version is ${formatCarePlanStatusLabel(planStatus).toLowerCase()}`
    : `${summary.addressed} addressed · ${summary.weaker} weaker · ${summary.notAddressed} not addressed · ${summary.notAssessed} not assessed on the 1823`;
  return (
    <RecordDetailSection title={`Form 1823 alignment · exam ${formatCarePlanDateOnly(form.exam_date)}`} description={description}>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.need} className="grid grid-cols-1 gap-2 py-2 text-sm sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
            <span className="font-medium text-foreground">{row.need}</span>
            <span className="text-muted-foreground">1823: {row.form1823}</span>
            <span className="text-muted-foreground">Plan: {row.plan ?? "No line"}</span>
            <Badge className={cn("justify-self-start text-[10px] uppercase font-bold tracking-wider px-2.5 border shadow-none sm:justify-self-end", ALIGNMENT_STATE_CLASS[row.state])}>
              {ALIGNMENT_STATE_LABELS[row.state]}
            </Badge>
          </li>
        ))}
      </ul>
    </RecordDetailSection>
  );
}

function groupByCategory(items: CarePlanItemRow[]): Map<string, CarePlanItemRow[]> {
  const map = new Map<string, CarePlanItemRow[]>();
  for (const item of items) {
    const key = item.category ?? "other";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
