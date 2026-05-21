"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "@/design-system/components/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { formatColLabel } from "@/lib/col-labels";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { AdmissionsHubScope } from "@/lib/admin/admissions/hub-scope";
import {
  admissionsHubActivityLowerBoundUtc,
  admissionsHubCalendarUpperBoundUtc,
  admissionsHubScopeFromSearchParam,
} from "@/lib/admin/admissions/hub-scope";

type LeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  "id" | "first_name" | "last_name" | "status" | "updated_at"
> & {
  referral_sources: { name: string } | null;
};

type HandoffPhase = "blocked" | "ready" | "onboarding" | "complete";

type CaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "target_move_in_date"
  | "financial_clearance_at"
  | "physician_orders_received_at"
  | "bed_id"
  | "resident_id"
  | "referral_lead_id"
  | "medicaid_pipeline_stage"
> & {
  residents: { first_name: string; last_name: string } | null;
};

type AdmissionPhase = "blocked" | "ready" | "onboarding" | "stable";

type DischargeRow = Pick<
  Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "nurse_reconciliation_notes"
  | "pharmacist_npi"
  | "pharmacist_notes"
> & {
  residents: { first_name: string; last_name: string; discharge_target_date: string | null; hospice_status: string } | null;
};

type DischargePhase = "planning" | "pharmacist_review" | "ready_to_complete" | "complete" | "cancelled";

type TriageRow = Pick<
  Database["public"]["Tables"]["family_message_triage_items"]["Row"],
  "id" | "updated_at" | "matched_keywords" | "triage_status"
> & {
  residents: { first_name: string; last_name: string } | null;
};

type ConferenceRow = Pick<
  Database["public"]["Tables"]["family_care_conference_sessions"]["Row"],
  | "id"
  | "scheduled_start"
  | "updated_at"
  | "status"
  | "recording_consent"
  | "recording_consent_at"
  | "recording_consent_by"
> & {
  residents: { first_name: string; last_name: string } | null;
};

const ADMISSIONS_HUB_PREVIEW_LIMIT = 100;

function formatStatus(s: string) {
  return formatColLabel(s);
}

function formatMedicaidStage(stage: string | null) {
  if (!stage) return "Not set";
  return formatStatus(stage);
}

function formatRelative(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function leadPriority(status: Database["public"]["Enums"]["referral_lead_status"], handoffPhase: HandoffPhase | null): number {
  if (handoffPhase === "blocked") return 0;
  if (handoffPhase === "ready") return 1;
  if (handoffPhase === "onboarding") return 2;
  if (status === "new") return 3;
  if (status === "contacted") return 4;
  if (status === "tour_scheduled") return 5;
  if (status === "tour_completed") return 6;
  if (status === "application_pending") return 7;
  if (status === "waitlisted") return 8;
  if (status === "converted") return 9;
  if (status === "lost") return 10;
  return 11;
}

function admissionBlockers(row: CaseRow): string[] {
  const blockers: string[] = [];
  if (!row.financial_clearance_at) blockers.push("financial");
  if (!row.physician_orders_received_at) blockers.push("orders");
  if (!row.bed_id) blockers.push("bed");
  if (!row.target_move_in_date) blockers.push("move-in date");
  return blockers;
}

function describeDischargePhase(row: DischargeRow): {
  phase: DischargePhase;
  helperText: string;
  nextActionLabel: string;
} {
  if (row.status === "cancelled") {
    return {
      phase: "cancelled",
      helperText: "Reconciliation cancelled.",
      nextActionLabel: "Cancelled",
    };
  }
  if (row.status === "complete") {
    return {
      phase: "complete",
      helperText: "Reconciliation and transition planning are complete.",
      nextActionLabel: "Complete",
    };
  }
  if (!row.residents?.discharge_target_date) {
    return {
      phase: "planning",
      helperText: "Set the resident discharge target date.",
      nextActionLabel: "Set discharge date",
    };
  }
  if (row.residents?.hospice_status === "pending") {
    return {
      phase: "planning",
      helperText: "Resolve hospice planning before transition completes.",
      nextActionLabel: "Confirm hospice",
    };
  }
  if (!row.nurse_reconciliation_notes?.trim()) {
    return {
      phase: "planning",
      helperText: "Add nurse reconciliation notes before pharmacist handoff.",
      nextActionLabel: "Add nurse notes",
    };
  }
  if (row.status === "draft") {
    return {
      phase: "pharmacist_review",
      helperText: "Ready to move into pharmacist review.",
      nextActionLabel: "Send to pharmacist",
    };
  }
  if (!row.pharmacist_npi?.trim() || !row.pharmacist_notes?.trim()) {
    return {
      phase: "pharmacist_review",
      helperText: "Awaiting pharmacist attestation fields.",
      nextActionLabel: "Finish pharmacist review",
    };
  }
  return {
    phase: "ready_to_complete",
    helperText: "Pharmacist review is in place; this can be completed.",
    nextActionLabel: "Mark complete",
  };
}

function describeAdmissionPhase(
  row: CaseRow,
  onboardingState: Record<string, string[]>,
): {
  phase: AdmissionPhase;
  nextActionLabel: string;
  nextActionHref: string;
  helperText: string;
} {
  const blockers = admissionBlockers(row);
  if (blockers.length > 0) {
    return {
      phase: "blocked",
      nextActionLabel: "Clear blockers",
      nextActionHref: "/admin/admissions/blocked",
      helperText: `Blockers: ${blockers.join(" · ")}`,
    };
  }
  if (row.status !== "move_in") {
    return {
      phase: "ready",
      nextActionLabel: "Advance move-in",
      nextActionHref: "/admin/admissions/move-in-ready",
      helperText: "Ready for next move-in step.",
    };
  }
  const onboardingMissing = onboardingState[row.id] ?? [];
  if (onboardingMissing.length > 0) {
    return {
      phase: "onboarding",
      nextActionLabel: "Finish onboarding",
      nextActionHref: "/admin/admissions/onboarding",
      helperText: `Onboarding: ${onboardingMissing.join(" · ")}`,
    };
  }
  return {
    phase: "stable",
    nextActionLabel: "Open onboarding",
    nextActionHref: "/admin/admissions/onboarding",
    helperText: "Move-in complete and downstream setup is clear.",
  };
}

function HubSection({
  title,
  viewAllHref,
  metrics,
  children,
}: {
  title: string;
  viewAllHref: string;
  metrics: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="section-header text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <Link
          href={viewAllHref}
          className="view-all shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View all →
        </Link>
      </div>
      <div>{metrics}</div>
      <div>{children}</div>
    </section>
  );
}

function InlineMetricsRow({ parts }: { parts: { label: string; value: string | number }[] }) {
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((p, idx) => (
        <span key={p.label}>
          {idx > 0 ? <span className="text-muted-foreground/50"> · </span> : null}
          <span className="text-muted-foreground">{p.label}:</span>{" "}
          <span className="font-medium tabular-nums text-foreground">{p.value}</span>
        </span>
      ))}
    </p>
  );
}

function QuietInlineArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
    >
      {children}
    </Link>
  );
}

function AdminAdmissionsOverviewInner() {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hubScope = admissionsHubScopeFromSearchParam(searchParams.get("scope"));

  const { selectedFacilityId, availableFacilities } = useFacilityStore((s) => ({
    selectedFacilityId: s.selectedFacilityId,
    availableFacilities: s.availableFacilities,
  }));
  const { user } = useHavenAuth();

  const loadContextRef = useRef({ selectedFacilityId, hubScope });
  useEffect(() => {
    loadContextRef.current = { selectedFacilityId, hubScope };
  }, [hubScope, selectedFacilityId]);
  const isCurrentLoadContext = useCallback(
    (facilityId: string | null, scope: AdmissionsHubScope) =>
      loadContextRef.current.selectedFacilityId === facilityId && loadContextRef.current.hubScope === scope,
    [],
  );

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [onboardingState, setOnboardingState] = useState<Record<string, string[]>>({});

  const [referrals, setReferrals] = useState<LeadRow[]>([]);
  const [admissions, setAdmissions] = useState<CaseRow[]>([]);
  const [discharges, setDischarges] = useState<DischargeRow[]>([]);
  const [triage, setTriage] = useState<TriageRow[]>([]);
  const [conferences, setConferences] = useState<ConferenceRow[]>([]);

  const [referralMetrics, setReferralMetrics] = useState({ activePipeline: 0 });
  const [admissionMetrics, setAdmissionMetrics] = useState({ pending: 0, reserved: 0, moveIn: 0 });
  const [dischargeMetrics, setDischargeMetrics] = useState({ inReview: 0 });
  const [familyMetrics, setFamilyMetrics] = useState({ triage: 0, conferences: 0, consentsPending: 0 });

  const [familyActionLoading, setFamilyActionLoading] = useState<string | null>(null);
  const [familyActionError, setFamilyActionError] = useState<string | null>(null);
  const [familyActionMessage, setFamilyActionMessage] = useState<string | null>(null);

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!isCurrent()) return;
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      if (!isCurrent()) return;
      setReferrals([]);
      setAdmissions([]);
      setDischarges([]);
      setTriage([]);
      setConferences([]);
      setReferralMetrics({ activePipeline: 0 });
      setAdmissionMetrics({ pending: 0, reserved: 0, moveIn: 0 });
      setDischargeMetrics({ inReview: 0 });
      setFamilyMetrics({ triage: 0, conferences: 0, consentsPending: 0 });
      setLoading(false);
      return;
    }

    const activityLower = admissionsHubActivityLowerBoundUtc(hubScope);
    const calendarUpper = admissionsHubCalendarUpperBoundUtc(hubScope);
    const nowIso = new Date().toISOString();

    try {
      let refSel = supabase
        .from("referral_leads")
        .select("id, first_name, last_name, status, updated_at, referral_sources(name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(converted,lost,merged)")
        .order("updated_at", { ascending: false });
      if (activityLower) refSel = refSel.gte("updated_at", activityLower);
      refSel = refSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

      let admSel = supabase
        .from("admission_cases")
        .select(
          "id, referral_lead_id, status, medicaid_pipeline_stage, updated_at, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id, resident_id, residents(first_name, last_name)",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .order("updated_at", { ascending: false });
      if (activityLower) admSel = admSel.gte("updated_at", activityLower);
      admSel = admSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

      let disSel = supabase
        .from("discharge_med_reconciliation")
        .select("id, status, updated_at, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(first_name, last_name, discharge_target_date, hospice_status)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .order("updated_at", { ascending: false });
      if (activityLower) disSel = disSel.gte("updated_at", activityLower);
      disSel = disSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

      let triSel = supabase
        .from("family_message_triage_items")
        .select("id, updated_at, matched_keywords, triage_status, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("triage_status", ["pending_review", "in_review"])
        .order("updated_at", { ascending: false });
      if (activityLower) triSel = triSel.gte("updated_at", activityLower);
      triSel = triSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

      let confSel = supabase
        .from("family_care_conference_sessions")
        .select("id, scheduled_start, updated_at, status, recording_consent, recording_consent_at, recording_consent_by, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .gte("scheduled_start", nowIso)
        .order("scheduled_start", { ascending: true });
      if (calendarUpper) confSel = confSel.lte("scheduled_start", calendarUpper);
      confSel = confSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

      let cRefPipe = supabase
        .from("referral_leads")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(converted,lost,merged)");
      if (activityLower) cRefPipe = cRefPipe.gte("updated_at", activityLower);

      let cAdmPend = supabase
        .from("admission_cases")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("status", "pending_clearance");
      if (activityLower) cAdmPend = cAdmPend.gte("updated_at", activityLower);

      let cAdmRes = supabase
        .from("admission_cases")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("status", "bed_reserved");
      if (activityLower) cAdmRes = cAdmRes.gte("updated_at", activityLower);

      let cAdmMove = supabase
        .from("admission_cases")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("status", "move_in");
      if (activityLower) cAdmMove = cAdmMove.gte("updated_at", activityLower);

      let cDisRev = supabase
        .from("discharge_med_reconciliation")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("status", "pharmacist_review");
      if (activityLower) cDisRev = cDisRev.gte("updated_at", activityLower);

      let cFamTriage = supabase
        .from("family_message_triage_items")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("triage_status", ["pending_review", "in_review"]);
      if (activityLower) cFamTriage = cFamTriage.gte("updated_at", activityLower);

      let cFamConf = supabase
        .from("family_care_conference_sessions")
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .gte("scheduled_start", nowIso);
      if (calendarUpper) cFamConf = cFamConf.lte("scheduled_start", calendarUpper);

      let cFamConsent = supabase.from("family_consent_records").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null);
      if (hubScope !== "all" && activityLower) cFamConsent = cFamConsent.gte("updated_at", activityLower);

      const [
        refList,
        admList,
        disList,
        triList,
        confList,
        pipeCt,
        admPendCt,
        admResCt,
        admMoveCt,
        disRevCt,
        famTriageCt,
        famConfCt,
        famConsentCt,
      ] = await Promise.all([
        refSel,
        admSel,
        disSel,
        triSel,
        confSel,
        cRefPipe,
        cAdmPend,
        cAdmRes,
        cAdmMove,
        cDisRev,
        cFamTriage,
        cFamConf,
        cFamConsent,
      ]);

      if (!isCurrent()) return;

      setReferrals((refList.data ?? []) as LeadRow[]);
      const admissionRows = (admList.data ?? []) as CaseRow[];
      setAdmissions(admissionRows);
      setDischarges((disList.data ?? []) as DischargeRow[]);
      setTriage((triList.data ?? []) as TriageRow[]);
      setConferences((confList.data ?? []) as ConferenceRow[]);

      setReferralMetrics({ activePipeline: (pipeCt.count ?? 0) as number });
      setAdmissionMetrics({
        pending: (admPendCt.count ?? 0) as number,
        reserved: (admResCt.count ?? 0) as number,
        moveIn: (admMoveCt.count ?? 0) as number,
      });
      setDischargeMetrics({ inReview: (disRevCt.count ?? 0) as number });
      setFamilyMetrics({
        triage: (famTriageCt.count ?? 0) as number,
        conferences: (famConfCt.count ?? 0) as number,
        consentsPending: (famConsentCt.count ?? 0) as number,
      });
    } catch (e) {
      if (isCurrent()) {
        setLoadError(e instanceof Error ? e.message : "Could not load data.");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [supabase, selectedFacilityId, hubScope]);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function updateTriageStatus(
    itemId: string,
    triageStatus: Database["public"]["Enums"]["family_message_triage_status"],
    successMessage: string,
  ) {
    const actionFacilityId = selectedFacilityId;
    const actionHubScope = hubScope;

    setFamilyActionLoading(itemId);
    setFamilyActionError(null);
    setFamilyActionMessage(null);
    try {
      const { error } = await supabase
        .from("family_message_triage_items")
        .update({
          triage_status: triageStatus,
          reviewed_at: triageStatus === "resolved" || triageStatus === "false_positive" ? new Date().toISOString() : null,
          reviewed_by: triageStatus === "resolved" || triageStatus === "false_positive" ? user?.id ?? null : null,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", itemId);
      if (error) throw error;
      if (isCurrentLoadContext(actionFacilityId, actionHubScope)) setFamilyActionMessage(successMessage);
      await load(() => isCurrentLoadContext(actionFacilityId, actionHubScope));
    } catch (err) {
      if (isCurrentLoadContext(actionFacilityId, actionHubScope)) {
        setFamilyActionError(err instanceof Error ? err.message : "Could not update triage item.");
      }
    } finally {
      setFamilyActionLoading(null);
    }
  }

  async function updateConference(
    sessionId: string,
    patch: Partial<Database["public"]["Tables"]["family_care_conference_sessions"]["Update"]>,
    successMessage: string,
  ) {
    const actionFacilityId = selectedFacilityId;
    const actionHubScope = hubScope;

    setFamilyActionLoading(sessionId);
    setFamilyActionError(null);
    setFamilyActionMessage(null);
    try {
      const { error } = await supabase
        .from("family_care_conference_sessions")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", sessionId);
      if (error) throw error;
      if (isCurrentLoadContext(actionFacilityId, actionHubScope)) setFamilyActionMessage(successMessage);
      await load(() => isCurrentLoadContext(actionFacilityId, actionHubScope));
    } catch (err) {
      if (isCurrentLoadContext(actionFacilityId, actionHubScope)) {
        setFamilyActionError(err instanceof Error ? err.message : "Could not update care conference.");
      }
    } finally {
      setFamilyActionLoading(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadOnboardingState() {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || admissions.length === 0) {
        if (!cancelled) setOnboardingState({});
        return;
      }
      const moveInCases = admissions.filter((row) => row.status === "move_in" && row.resident_id);
      const residentIds = moveInCases.map((row) => row.resident_id).filter(Boolean) as string[];
      if (residentIds.length === 0) {
        if (!cancelled) setOnboardingState({});
        return;
      }
      const client = createClient();
      const [carePlansRes, medsRes, payersRes, consentsRes] = await Promise.all([
        client.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        client.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        client.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        client.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
      ]);
      if (cancelled) return;
      if (carePlansRes.error || medsRes.error || payersRes.error || consentsRes.error) {
        setOnboardingState({});
        return;
      }
      const carePlanIds = new Set((carePlansRes.data ?? []).map((row) => row.resident_id));
      const medIds = new Set((medsRes.data ?? []).map((row) => row.resident_id));
      const payerIds = new Set((payersRes.data ?? []).map((row) => row.resident_id));
      const consentIds = new Set((consentsRes.data ?? []).map((row) => row.resident_id));
      setOnboardingState(
        Object.fromEntries(
          moveInCases.map((row) => {
            const residentId = row.resident_id as string;
            const missing = [
              !carePlanIds.has(residentId) ? "care plan" : null,
              !medIds.has(residentId) ? "medications" : null,
              !payerIds.has(residentId) ? "billing" : null,
              !consentIds.has(residentId) ? "family consent" : null,
            ].filter((value): value is string => Boolean(value));
            return [row.id, missing];
          }),
        ),
      );
    }

    void loadOnboardingState();
    return () => {
      cancelled = true;
    };
  }, [admissions, selectedFacilityId]);

  const featuredAdmissions = useMemo(() => {
    const phaseOrder: Record<AdmissionPhase, number> = {
      blocked: 0,
      ready: 1,
      onboarding: 2,
      stable: 3,
    };
    return [...admissions]
      .sort((a, b) => {
        const phaseA = describeAdmissionPhase(a, onboardingState).phase;
        const phaseB = describeAdmissionPhase(b, onboardingState).phase;
        const phaseDelta = phaseOrder[phaseA] - phaseOrder[phaseB];
        if (phaseDelta !== 0) return phaseDelta;
        return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
      })
      .slice(0, 8);
  }, [admissions, onboardingState]);

  const activeAdmissionCaseByLeadId = useMemo(() => {
    return Object.fromEntries(
      admissions
        .filter((row) => !!row.referral_lead_id)
        .map((row) => {
          const blockers = admissionBlockers(row);
          let phase: HandoffPhase = "complete";
          if (blockers.length > 0) {
            phase = "blocked";
          } else if (row.status !== "move_in") {
            phase = "ready";
          } else if ((onboardingState[row.id] ?? []).length > 0) {
            phase = "onboarding";
          }
          return [row.referral_lead_id as string, { id: row.id, phase }] as const;
        }),
    );
  }, [admissions, onboardingState]);

  const featuredReferrals = useMemo(() => {
    return [...referrals]
      .sort((a, b) => {
        const phaseA = activeAdmissionCaseByLeadId[a.id]?.phase ?? null;
        const phaseB = activeAdmissionCaseByLeadId[b.id]?.phase ?? null;
        const priorityDelta = leadPriority(a.status, phaseA) - leadPriority(b.status, phaseB);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, 8);
  }, [activeAdmissionCaseByLeadId, referrals]);

  const featuredDischarges = useMemo(() => {
    const phaseOrder: Record<DischargePhase, number> = {
      planning: 0,
      pharmacist_review: 1,
      ready_to_complete: 2,
      complete: 3,
      cancelled: 4,
    };
    return [...discharges]
      .sort((a, b) => {
        const phaseA = describeDischargePhase(a).phase;
        const phaseB = describeDischargePhase(b).phase;
        const phaseDelta = phaseOrder[phaseA] - phaseOrder[phaseB];
        if (phaseDelta !== 0) return phaseDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, 6);
  }, [discharges]);

  const featuredTriage = useMemo(() => {
    return [...triage].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6);
  }, [triage]);

  const featuredConferences = useMemo(() => {
    return [...conferences]
      .sort((a, b) => new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime())
      .slice(0, 6);
  }, [conferences]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  const blockedAdmissions = useMemo(() => {
    return admissions.map((row) => ({ row, blockers: admissionBlockers(row) })).filter((entry) => entry.blockers.length > 0).slice(0, 4);
  }, [admissions]);

  const hubFacilityLabel = useMemo(() => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      return "the selected facility";
    }
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? selectedFacilityId;
  }, [availableFacilities, selectedFacilityId]);

  const workflowQuietLinkClass = cn(buttonVariants({ variant: "ghost", size: "sm" }));

  function setHubScopeParam(next: AdmissionsHubScope) {
    const base = pathname ?? "/admin/admissions";
    const params = new URLSearchParams(searchParams.toString());
    if (next === "today") params.delete("scope");
    else params.set("scope", next);
    const query = params.toString();
    router.replace(query ? `${base}?${query}` : base, { scroll: false });
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 pb-28 pt-6">
      <PageHeader
        title="Admissions overview"
        subtitle={
          <>
            Intake and discharge pipeline for <span className="text-foreground">{hubFacilityLabel}</span>. For clinical care during residency,
            see the Clinical tab.
          </>
        }
        actions={
          <div className="flex w-full flex-wrap items-center justify-start gap-3 sm:w-auto sm:justify-end">
            <div className="flex items-center gap-2">
              <Label htmlFor="admissions-hub-scope" className="sr-only">
                Time scope
              </Label>
              <Select value={hubScope} onValueChange={(v) => setHubScopeParam(admissionsHubScopeFromSearchParam(v))}>
                <SelectTrigger id="admissions-hub-scope" className="h-9 w-[156px]">
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This week</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {!noFacility ? (
                <>
                  <Link href="/admin/referrals/new" className={workflowQuietLinkClass}>
                    + New referral
                  </Link>
                  <Link href="/admin/admissions/new" className={workflowQuietLinkClass}>
                    Start admission
                  </Link>
                  <Link href="/pipeline/discharge-management/new-reconciliation" className={workflowQuietLinkClass}>
                    Process discharge
                  </Link>
                </>
              ) : (
                <>
                  <span className={cn(workflowQuietLinkClass, "pointer-events-none opacity-40")}>+ New referral</span>
                  <span className={cn(workflowQuietLinkClass, "pointer-events-none opacity-40")}>Start admission</span>
                  <span className={cn(workflowQuietLinkClass, "pointer-events-none opacity-40")}>Process discharge</span>
                </>
              )}
            </div>
          </div>
        }
      />

      {noFacility ? (
        <div role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Select a facility in the header to load intake and discharge metrics.
        </div>
      ) : null}

      {/* FOLLOW-UP(ISSUE): Consider consolidating Family Portal + Family Messages sidebar entries per hub IA decision. */}

      {loadError ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-6 text-sm text-rose-700 dark:text-rose-400">
          {loadError}
        </div>
      ) : null}

      {!noFacility &&
      !loading &&
      !loadError &&
      hubScope !== "all" &&
      referrals.length === 0 &&
      admissions.length === 0 &&
      discharges.length === 0 &&
      triage.length === 0 &&
      conferences.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Nothing updated within the current scope ({hubScope === "today" ? "today" : hubScope === "week" ? "this week" : "this month"}).
            Imported or historical records may live outside this window.
          </p>
          <button
            type="button"
            onClick={() => setHubScopeParam("all")}
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-amber-500/40 bg-amber-500/15 px-3 text-[12px] font-medium text-amber-900 transition-colors hover:bg-amber-500/25 dark:text-amber-100"
          >
            View all time
          </button>
        </div>
      ) : null}

      <HubSection
        title="Referrals"
        viewAllHref="/admin/referrals"
        metrics={
          <InlineMetricsRow
            parts={[
              { label: "Active pipeline", value: noFacility ? "—" : loading ? "—" : referralMetrics.activePipeline },
            ]}
          />
        }
      >
        {noFacility ? (
          <p className="text-sm text-muted-foreground">Select a facility to preview referrals.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading referrals…</p>
        ) : referrals.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No active leads. New referrals appear here once captured.
          </p>
        ) : (
          <div className="space-y-3">
            {featuredReferrals.map((r) => {
              const isNew = r.status === "new";
              const linkedAdmission = activeAdmissionCaseByLeadId[r.id] ?? null;
              const handoffPhase = linkedAdmission?.phase ?? null;
              return (
                <Link
                  key={r.id}
                  href={`/admin/referrals/${r.id}`}
                  className="flex min-h-[36px] w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
                    {isNew ? null : <div className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{r.first_name} {r.last_name}</span>
                      <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
                        {formatStatus(r.status)}
                      </span>
                      {handoffPhase === "blocked" ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                          Blocked
                        </span>
                      ) : handoffPhase === "ready" ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                          Ready
                        </span>
                      ) : handoffPhase === "onboarding" ? (
                        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Onboarding
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {r.referral_sources?.name ?? "No source"} · {formatRelative(r.updated_at)}
                    </p>
                    {handoffPhase ? (
                      <p
                        className={cn(
                          "mt-1 text-[11px]",
                          handoffPhase === "blocked"
                            ? "text-amber-800 dark:text-amber-300"
                            : handoffPhase === "ready"
                              ? "text-emerald-800 dark:text-emerald-300"
                              : "text-primary",
                        )}
                      >
                        {handoffPhase === "blocked"
                          ? "Admissions handoff blocked."
                          : handoffPhase === "ready"
                            ? "Admissions handoff ready."
                            : "Admissions handoff in onboarding."}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </HubSection>

      <HubSection
        title="Admissions"
        viewAllHref="/admin/admissions/onboarding"
        metrics={
          <InlineMetricsRow
            parts={[
              { label: "Pending", value: noFacility ? "—" : loading ? "—" : admissionMetrics.pending },
              { label: "Bed reserved", value: noFacility ? "—" : loading ? "—" : admissionMetrics.reserved },
              { label: "Move-in ready", value: noFacility ? "—" : loading ? "—" : admissionMetrics.moveIn },
            ]}
          />
        }
      >
        {noFacility ? (
          <p className="text-sm text-muted-foreground">Select a facility to preview admissions.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading admissions…</p>
        ) : admissions.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No active cases. <QuietInlineArrowLink href="/admin/admissions/new">Start an admission →</QuietInlineArrowLink>
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Queues · <QuietInlineArrowLink href="/admin/admissions/onboarding">Onboarding →</QuietInlineArrowLink>
              {" · "}
              <QuietInlineArrowLink href="/admin/admissions/blocked">Blocked readiness →</QuietInlineArrowLink>
              {" · "}
              <QuietInlineArrowLink href="/admin/admissions/move-in-ready">Move-in ready →</QuietInlineArrowLink>
            </p>

            {blockedAdmissions.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/[0.04] p-4">
                <p className="text-[13px] font-medium text-foreground">
                  {blockedAdmissions.length} blocked readiness case{blockedAdmissions.length === 1 ? "" : "s"}
                </p>
                <div className="grid gap-2">
                  {blockedAdmissions.map(({ row, blockers }) => (
                    <Link
                      key={row.id}
                      href={`/admin/admissions/${row.id}`}
                      className="rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-muted/40"
                    >
                      <div className="font-medium text-foreground">{row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unlinked case"}</div>
                      <div className="mt-0.5 text-[12px] text-amber-900 dark:text-amber-300">{blockers.join(" · ")}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              {featuredAdmissions.map((r) => {
                const isPending = r.status === "pending_clearance";
                const phase = describeAdmissionPhase(r, onboardingState);
                return (
                  <Link
                    key={r.id}
                    href={`/admin/admissions/${r.id}`}
                    className="flex min-h-[36px] w-full cursor-pointer gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
                      {isPending ? null : <div className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">{r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "Unlinked case"}</span>
                        <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
                          {formatStatus(r.status)}
                        </span>
                        {phase.phase === "blocked" ? (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                            Blocked
                          </span>
                        ) : phase.phase === "ready" ? (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                            Ready
                          </span>
                        ) : phase.phase === "onboarding" ? (
                          <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            Onboarding
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {r.target_move_in_date ? `Target: ${r.target_move_in_date}` : "No date set"} · {formatRelative(r.updated_at)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Medicaid stage: {formatMedicaidStage(r.medicaid_pipeline_stage)}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-[11px]",
                          phase.phase === "blocked"
                            ? "text-amber-800 dark:text-amber-300"
                            : phase.phase === "ready"
                              ? "text-emerald-800 dark:text-emerald-300"
                              : phase.phase === "onboarding"
                                ? "text-primary"
                                : "text-muted-foreground",
                        )}
                      >
                        {phase.helperText}
                      </p>
                    </div>
                    <div className="hidden shrink-0 xl:block">
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize",
                          phase.phase === "blocked"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                            : phase.phase === "ready"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                              : phase.phase === "onboarding"
                                ? "border-primary/25 bg-primary/10 text-primary"
                                : "border-border bg-muted/50 text-foreground",
                        )}
                      >
                        {phase.nextActionLabel}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </HubSection>

      <HubSection title="Discharges" viewAllHref="/pipeline/discharge-management" metrics={<InlineMetricsRow parts={[{ label: "In review", value: noFacility ? "—" : loading ? "—" : dischargeMetrics.inReview }]} />}>
        {noFacility ? (
          <p className="text-sm text-muted-foreground">Select a facility to preview discharge work.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading discharges…</p>
        ) : discharges.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No active reconciliations. <QuietInlineArrowLink href="/pipeline/discharge-management/new-reconciliation">Start a discharge →</QuietInlineArrowLink>
          </p>
        ) : (
          <div className="space-y-3">
            {featuredDischarges.map((r) => {
              const isDraft = r.status === "draft";
              const phase = describeDischargePhase(r);
              return (
                <Link
                  key={r.id}
                  href={`/admin/discharge/${r.id}`}
                  className="flex min-h-[36px] w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
                    {isDraft ? null : <div className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "Unlinked reconciliation"}
                      </span>
                      <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
                        {formatStatus(r.status)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
                          phase.phase === "planning"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                            : phase.phase === "pharmacist_review"
                              ? "border-primary/25 bg-primary/10 text-primary"
                              : phase.phase === "ready_to_complete"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                                : "border-border bg-muted/50 text-foreground",
                        )}
                      >
                        {phase.nextActionLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">Updated {formatRelative(r.updated_at)}</p>
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        phase.phase === "planning"
                          ? "text-amber-800 dark:text-amber-300"
                          : phase.phase === "pharmacist_review"
                            ? "text-primary"
                            : phase.phase === "ready_to_complete"
                              ? "text-emerald-800 dark:text-emerald-300"
                              : "text-muted-foreground",
                      )}
                    >
                      {phase.helperText}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </HubSection>

      <HubSection
        title="Family connections"
        viewAllHref="/admin/family-portal"
        metrics={
          <InlineMetricsRow
            parts={[
              { label: "Triage alerts", value: noFacility ? "—" : loading ? "—" : familyMetrics.triage },
              { label: "Upcoming conferences", value: noFacility ? "—" : loading ? "—" : familyMetrics.conferences },
              { label: "Consents pending", value: noFacility ? "—" : loading ? "—" : familyMetrics.consentsPending },
            ]}
          />
        }
      >
        {familyActionError ? (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">{familyActionError}</div>
        ) : null}
        {familyActionMessage ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{familyActionMessage}</div>
        ) : null}
        {noFacility ? (
          <p className="text-sm text-muted-foreground">Select a facility to preview family connections.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading family connections…</p>
        ) : triage.length === 0 && conferences.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No items need attention. <QuietInlineArrowLink href="/admin/family-messages">View all family conversations →</QuietInlineArrowLink>
          </p>
        ) : (
          <div className="space-y-3">
            {featuredTriage.map((t) => (
              <Link
                key={`triage-${t.id}`}
                href="/admin/family-portal"
                className="flex min-h-[36px] w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {t.residents ? `${t.residents.first_name} ${t.residents.last_name}` : "Unknown resident"}
                    </span>
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground">Triage alert</span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {(t.matched_keywords ?? []).join(", ") || "Keywords detected"} · {formatRelative(t.updated_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={familyActionLoading === t.id || t.triage_status === "in_review"} onClick={(event) => { event.preventDefault(); void updateTriageStatus(t.id, "in_review", "Message triage moved to in review."); }}>
                      In review
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={familyActionLoading === t.id || t.triage_status === "resolved"} onClick={(event) => { event.preventDefault(); void updateTriageStatus(t.id, "resolved", "Message triage resolved."); }}>
                      Resolve
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={familyActionLoading === t.id || t.triage_status === "false_positive"} onClick={(event) => { event.preventDefault(); void updateTriageStatus(t.id, "false_positive", "Message triage marked false positive."); }}>
                      False positive
                    </Button>
                  </div>
                </div>
              </Link>
            ))}

            {featuredConferences.map((c) => (
              <Link
                key={`conf-${c.id}`}
                href="/admin/family-portal"
                className="flex min-h-[36px] w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-[13px] py-2 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
                  <div className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {c.residents ? `${c.residents.first_name} ${c.residents.last_name}` : "Unknown resident"}
                    </span>
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground">
                      Conference
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {(c.scheduled_start ? new Date(c.scheduled_start).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date")} ·{" "}
                    {formatRelative(c.updated_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={familyActionLoading === c.id || c.status === "completed"}
                      onClick={(event) => {
                        event.preventDefault();
                        void updateConference(c.id, { status: "completed" }, "Care conference marked completed.");
                      }}
                    >
                      Complete
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={familyActionLoading === c.id || c.status === "cancelled"}
                      onClick={(event) => {
                        event.preventDefault();
                        void updateConference(c.id, { status: "cancelled" }, "Care conference cancelled.");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={familyActionLoading === c.id || !!c.recording_consent}
                      onClick={(event) => {
                        event.preventDefault();
                        void updateConference(
                          c.id,
                          {
                            recording_consent: true,
                            recording_consent_at: c.recording_consent_at ?? new Date().toISOString(),
                            recording_consent_by: c.recording_consent_by ?? user?.id ?? null,
                          },
                          "Recording consent documented.",
                        );
                      }}
                    >
                      Record consent
                    </Button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </HubSection>
    </div>
  );
}

export default function AdminAdmissionsHubPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-1 pb-28 pt-6 text-sm text-muted-foreground">Loading admissions overview…</div>}>
      <AdminAdmissionsOverviewInner />
    </Suspense>
  );
}
