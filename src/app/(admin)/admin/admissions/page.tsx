"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus, Home, DoorOpen, MessageCircle, ArrowRight, Plus } from "lucide-react";

import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

// Types for each section
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
  "id" | "updated_at" | "matched_keywords"
> & {
  residents: { first_name: string; last_name: string } | null;
};

type ConferenceRow = Pick<
  Database["public"]["Tables"]["family_care_conference_sessions"]["Row"],
  "id" | "scheduled_start" | "updated_at"
> & {
  residents: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
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

// Section component for lifecycle stages
function LifecycleSection({
  title,
  color,
  icon: Icon,
  metrics,
  allHref,
  children,
}: {
  title: string;
  color: "emerald" | "indigo" | "rose" | "amber";
  icon: React.ElementType;
  metrics: { label: string; value: number | string }[];
  allHref: string;
  children: React.ReactNode;
}) {
  const hoverGradient = {
    emerald: "from-emerald-500/10 via-emerald-500/0",
    indigo: "from-indigo-500/10 via-indigo-500/0",
    rose: "from-rose-500/10 via-rose-500/0",
    amber: "from-amber-500/10 via-amber-500/0",
  }[color];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          <h3 className="text-lg font-display font-medium text-slate-900 dark:text-white tracking-tight">
            {title}
          </h3>
        </div>
        <Link
          href={allHref}
          className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          View all →
        </Link>
      </div>

      {/* Metrics row */}
      <div className="flex gap-3 flex-wrap">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="px-4 py-2 rounded-full bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10 backdrop-blur-sm"
          >
            <span className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-zinc-500 mr-2">{m.label}</span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{m.value}</span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2rem] bg-white/60 dark:bg-white/[0.015] shadow-sm backdrop-blur-3xl overflow-hidden p-4 md:p-6 relative">
        <div className={cn(
          "absolute top-0 right-0 w-48 h-48 rounded-full blur-[60px] -mr-12 -mt-12 pointer-events-none opacity-50",
          `bg-${color}-500/10`
        )} />
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AdminAdmissionsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Referrals
  const [referrals, setReferrals] = useState<LeadRow[]>([]);
  const [referralCounts, setReferralCounts] = useState({ new: 0, pipeline: 0, converted: 0, attention: 0 });

  // Admissions
  const [admissions, setAdmissions] = useState<CaseRow[]>([]);
  const [admissionCounts, setAdmissionCounts] = useState({ pending: 0, reserved: 0, moveIn: 0, cancelled: 0, blocked: 0 });

  // Discharges
  const [discharges, setDischarges] = useState<DischargeRow[]>([]);
  const [dischargeCounts, setDischargeCounts] = useState({ draft: 0, review: 0, complete: 0, cancelled: 0 });

  // Family Connections
  const [triage, setTriage] = useState<TriageRow[]>([]);
  const [conferences, setConferences] = useState<ConferenceRow[]>([]);
  const [familyCounts, setFamilyCounts] = useState({ triage: 0, conferences: 0, consents: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setReferrals([]);
      setAdmissions([]);
      setDischarges([]);
      setTriage([]);
      setConferences([]);
      setReferralCounts({ new: 0, pipeline: 0, converted: 0, attention: 0 });
      setAdmissionCounts({ pending: 0, reserved: 0, moveIn: 0, cancelled: 0, blocked: 0 });
      setDischargeCounts({ draft: 0, review: 0, complete: 0, cancelled: 0 });
      setFamilyCounts({ triage: 0, conferences: 0, consents: 0 });
      setLoading(false);
      return;
    }

    try {
      const [
        refList,
        admList,
        disList,
        triList,
        confList,
        // Counts
        cRefNew,
        cRefPipe,
        cRefConv,
        cRefAtt,
        cAdmPend,
        cAdmRes,
        cAdmMove,
        cAdmCan,
        cDisDraft,
        cDisRev,
        cDisComp,
        cDisCan,
        cFamTriage,
        cFamConf,
        cFamCons,
      ] = await Promise.all([
        // Lists (limit 5 each for preview)
        supabase
          .from("referral_leads")
          .select("id, first_name, last_name, status, updated_at, referral_sources(name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("status", "in", "(converted,lost,merged)")
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase
          .from("admission_cases")
          .select("id, referral_lead_id, status, updated_at, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id, resident_id, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("status", "eq", "cancelled")
          .order("updated_at", { ascending: false }),
        supabase
          .from("discharge_med_reconciliation")
          .select("id, status, updated_at, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(first_name, last_name, discharge_target_date, hospice_status)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("status", "eq", "cancelled")
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase
          .from("family_message_triage_items")
          .select("id, updated_at, matched_keywords, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .in("triage_status", ["pending_review", "in_review"])
          .order("updated_at", { ascending: false })
          .limit(3),
        supabase
          .from("family_care_conference_sessions")
          .select("id, scheduled_start, updated_at, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .gte("scheduled_start", new Date().toISOString())
          .order("scheduled_start", { ascending: true })
          .limit(3),
        // Referral counts
        supabase.from("referral_leads").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "new"),
        supabase.from("referral_leads").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).not("status", "in", "(converted,lost,merged)"),
        supabase.from("referral_leads").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "converted"),
        supabase.from("referral_leads").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).in("status", ["new", "contacted"]),
        // Admission counts
        supabase.from("admission_cases").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "pending_clearance"),
        supabase.from("admission_cases").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "bed_reserved"),
        supabase.from("admission_cases").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "move_in"),
        supabase.from("admission_cases").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "cancelled"),
        // Discharge counts
        supabase.from("discharge_med_reconciliation").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "draft"),
        supabase.from("discharge_med_reconciliation").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "pharmacist_review"),
        supabase.from("discharge_med_reconciliation").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "complete"),
        supabase.from("discharge_med_reconciliation").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).eq("status", "cancelled"),
        // Family counts
        supabase.from("family_message_triage_items").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).in("triage_status", ["pending_review", "in_review"]),
        supabase.from("family_care_conference_sessions").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null).gte("scheduled_start", new Date().toISOString()),
        supabase.from("family_consent_records").select("id", { count: "exact", head: true }).eq("facility_id", selectedFacilityId).is("deleted_at", null),
      ]);

      setReferrals((refList.data ?? []) as LeadRow[]);
      const admissionRows = (admList.data ?? []) as CaseRow[];
      setAdmissions(admissionRows);
      setDischarges((disList.data ?? []) as DischargeRow[]);
      setTriage((triList.data ?? []) as TriageRow[]);
      setConferences((confList.data ?? []) as ConferenceRow[]);

      setReferralCounts({
        new: (cRefNew.count ?? 0) as number,
        pipeline: (cRefPipe.count ?? 0) as number,
        converted: (cRefConv.count ?? 0) as number,
        attention: (cRefAtt.count ?? 0) as number,
      });
      setAdmissionCounts({
        pending: (cAdmPend.count ?? 0) as number,
        reserved: (cAdmRes.count ?? 0) as number,
        moveIn: (cAdmMove.count ?? 0) as number,
        cancelled: (cAdmCan.count ?? 0) as number,
        blocked: admissionRows.filter((row) => admissionBlockers(row).length > 0).length,
      });
      setDischargeCounts({
        draft: (cDisDraft.count ?? 0) as number,
        review: (cDisRev.count ?? 0) as number,
        complete: (cDisComp.count ?? 0) as number,
        cancelled: (cDisCan.count ?? 0) as number,
      });
      setFamilyCounts({
        triage: (cFamTriage.count ?? 0) as number,
        conferences: (cFamConf.count ?? 0) as number,
        consents: (cFamCons.count ?? 0) as number,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);
  const blockedAdmissions = admissions
    .map((row) => ({ row, blockers: admissionBlockers(row) }))
    .filter((entry) => entry.blockers.length > 0)
    .slice(0, 4);
  const [onboardingState, setOnboardingState] = useState<Record<string, string[]>>({});

  useEffect(() => {
    async function loadOnboardingState() {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || admissions.length === 0) {
        setOnboardingState({});
        return;
      }
      const moveInCases = admissions.filter((row) => row.status === "move_in" && row.resident_id);
      const residentIds = moveInCases.map((row) => row.resident_id).filter(Boolean) as string[];
      if (residentIds.length === 0) {
        setOnboardingState({});
        return;
      }
      const supabase = createClient();
      const [carePlansRes, medsRes, payersRes, consentsRes] = await Promise.all([
        supabase.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        supabase.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        supabase.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        supabase.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
      ]);
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
  }, [admissions, selectedFacilityId]);

  function describeAdmissionPhase(row: CaseRow): {
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

  const featuredAdmissions = useMemo(() => {
    const phaseOrder: Record<AdmissionPhase, number> = {
      blocked: 0,
      ready: 1,
      onboarding: 2,
      stable: 3,
    };
    return [...admissions]
      .sort((a, b) => {
        const phaseA = describeAdmissionPhase(a).phase;
        const phaseB = describeAdmissionPhase(b).phase;
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

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-12 w-full">
      {/* ─── HEADER ─── */}
      <div className="bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
            SYS: Lifecycle
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white">
            Admissions
          </h1>
          <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
            Manage the complete resident journey — referrals, admissions, discharges, and family connections.
          </p>
        </div>
      </div>

      {noFacility ? (
        <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
            <span className="font-bold">!</span>
          </div>
          Select a facility in the header to load lifecycle data.
        </div>
      ) : null}

      {/* ─── QUICK ACTIONS ─── */}
      <div className="grid gap-4 sm:grid-cols-3 pt-2">
        <V2Card href="/admin/referrals/new" hoverColor="emerald" className="border-emerald-500/20 pb-0">
          <div className="flex items-center gap-4 h-full absolute inset-0 px-6">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-3 border border-emerald-100 dark:border-emerald-500/20 shrink-0">
              <Plus className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">
                New Referral
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">Add an inquiry to the pipeline</p>
            </div>
          </div>
        </V2Card>

        <V2Card href="/admin/admissions/new" hoverColor="indigo" className="border-indigo-500/20 pb-0">
          <div className="flex items-center gap-4 h-full absolute inset-0 px-6">
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-3 border border-indigo-100 dark:border-indigo-500/20 shrink-0">
              <Home className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                Start Admission
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">Begin the intake workflow</p>
            </div>
          </div>
        </V2Card>

        <V2Card href="/admin/discharge/new" hoverColor="rose" className="border-rose-500/20 pb-0">
          <div className="flex items-center gap-4 h-full absolute inset-0 px-6">
            <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 p-3 border border-rose-100 dark:border-rose-500/20 shrink-0">
              <DoorOpen className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors truncate">
                Process Discharge
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">Medication reconciliation</p>
            </div>
          </div>
        </V2Card>
      </div>

      {loadError ? (
        <div className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-700 dark:text-rose-400">
          {loadError}
        </div>
      ) : null}

      {/* ─── REFERRALS SECTION ─── */}
      <LifecycleSection
        title="Referrals"
        color="emerald"
        icon={UserPlus}
        allHref="/admin/referrals"
        metrics={[
          { label: "New", value: noFacility ? "—" : loading ? "—" : referralCounts.new },
          { label: "Active Pipeline", value: noFacility ? "—" : loading ? "—" : referralCounts.pipeline },
          { label: "Converted", value: noFacility ? "—" : loading ? "—" : referralCounts.converted },
        ]}
      >
        {noFacility ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Select a facility to view referrals.</p>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Loading...</p>
        ) : referrals.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
            No active leads. <Link href="/admin/referrals/new" className="underline text-emerald-600 dark:text-emerald-400">Create a referral</Link> to get started.
          </p>
        ) : (
          <MotionList className="space-y-3">
            {featuredReferrals.map((r) => {
              const isNew = r.status === "new";
              const linkedAdmission = activeAdmissionCaseByLeadId[r.id] ?? null;
              const handoffPhase = linkedAdmission?.phase ?? null;
              return (
                <MotionItem key={r.id}>
                  <Link
                    href={`/admin/referrals/${r.id}`}
                    className="flex items-center gap-3 p-4 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-all duration-300 w-full cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                      {isNew ? <PulseDot colorClass="bg-emerald-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                          {r.first_name} {r.last_name}
                        </span>
                        <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          {formatStatus(r.status)}
                        </span>
                        {handoffPhase === "blocked" ? (
                          <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                            Blocked
                          </span>
                        ) : handoffPhase === "ready" ? (
                          <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                            Ready
                          </span>
                        ) : handoffPhase === "onboarding" ? (
                          <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300">
                            Onboarding
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
                        {r.referral_sources?.name ?? "No source"} · {formatRelative(r.updated_at)}
                      </p>
                      {handoffPhase ? (
                        <p className={cn(
                          "mt-1 text-[11px]",
                          handoffPhase === "blocked"
                            ? "text-amber-700 dark:text-amber-300"
                            : handoffPhase === "ready"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-indigo-700 dark:text-indigo-300",
                        )}>
                          {handoffPhase === "blocked"
                            ? "Admissions handoff blocked."
                            : handoffPhase === "ready"
                              ? "Admissions handoff ready."
                              : "Admissions handoff in onboarding."}
                        </p>
                      ) : null}
                    </div>
                  </Link>
                </MotionItem>
              );
            })}
          </MotionList>
        )}
      </LifecycleSection>

      {/* ─── ADMISSIONS SECTION ─── */}
      <LifecycleSection
        title="Admissions"
        color="indigo"
        icon={Home}
        allHref="/admin/admissions"
        metrics={[
          { label: "Pending", value: noFacility ? "—" : loading ? "—" : admissionCounts.pending },
          { label: "Bed Reserved", value: noFacility ? "—" : loading ? "—" : admissionCounts.reserved },
          { label: "Move-In Ready", value: noFacility ? "—" : loading ? "—" : admissionCounts.moveIn },
          { label: "Blocked", value: noFacility ? "—" : loading ? "—" : admissionCounts.blocked },
        ]}
      >
        {noFacility ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Select a facility to view admissions.</p>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Loading...</p>
        ) : admissions.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
            No active cases. <Link href="/admin/admissions/new" className="underline text-indigo-600 dark:text-indigo-400">Start an admission</Link>.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border border-indigo-200/70 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/20 p-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300">Onboarding queue</p>
                <p className="text-sm text-indigo-900 dark:text-indigo-100">Cases already at move-in can continue through downstream onboarding from a single queue.</p>
              </div>
              <Link href="/admin/admissions/onboarding" className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100">
                Open onboarding →
              </Link>
            </div>

            {blockedAdmissions.length > 0 && (
              <div className="rounded-[1.5rem] border border-amber-200/70 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-mono text-amber-700 dark:text-amber-300">Move-in readiness pressure</p>
                    <p className="text-sm text-amber-900 dark:text-amber-100">These admissions are missing key readiness steps.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">{blockedAdmissions.length}</span>
                    <Link href="/admin/admissions/blocked" className="text-[10px] font-bold uppercase tracking-widest text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100">
                      Open blocked queue →
                    </Link>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  {blockedAdmissions.map(({ row, blockers }) => (
                    <Link
                      key={row.id}
                      href={`/admin/admissions/${row.id}`}
                      className="rounded-xl border border-amber-200/70 bg-white/80 dark:border-amber-900/40 dark:bg-black/20 p-4 transition-colors hover:bg-white dark:hover:bg-black/30"
                    >
                      <div className="font-medium text-slate-900 dark:text-white">
                        {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unlinked case"}
                      </div>
                      <div className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                        {blockers.join(" · ")}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20 p-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-mono text-emerald-700 dark:text-emerald-300">Ready queue</p>
                <p className="text-sm text-emerald-900 dark:text-emerald-100">Cases with core readiness items complete can be worked from one queue.</p>
              </div>
              <Link href="/admin/admissions/move-in-ready" className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100">
                Open move-in ready →
              </Link>
            </div>

            <MotionList className="space-y-3">
            {featuredAdmissions.map((r) => {
              const isPending = r.status === "pending_clearance";
              const phase = describeAdmissionPhase(r);
              return (
                <MotionItem key={r.id}>
                  <Link
                    href={`/admin/admissions/${r.id}`}
                    className="flex items-center gap-3 p-4 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 w-full cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                      {isPending ? <PulseDot colorClass="bg-rose-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "Unlinked case"}
                        </span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border",
                          isPending
                            ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                            : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        )}>
                          {formatStatus(r.status)}
                        </span>
                        {phase.phase === "blocked" ? (
                          <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                            Blocked
                          </span>
                        ) : phase.phase === "ready" ? (
                          <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                            Ready
                          </span>
                        ) : phase.phase === "onboarding" ? (
                          <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300">
                            Onboarding
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
                        {r.target_move_in_date ? `Target: ${r.target_move_in_date}` : "No date set"} · {formatRelative(r.updated_at)}
                      </p>
                      <p className={cn(
                        "mt-1 text-[11px]",
                        phase.phase === "blocked"
                          ? "text-amber-700 dark:text-amber-300"
                          : phase.phase === "ready"
                            ? "text-emerald-700 dark:text-emerald-300"
                            : phase.phase === "onboarding"
                              ? "text-indigo-700 dark:text-indigo-300"
                              : "text-slate-600 dark:text-zinc-400",
                      )}>
                        {phase.helperText}
                      </p>
                    </div>
                    <div className="shrink-0 hidden xl:flex">
                      <span className={cn(
                        "rounded-full px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest border",
                        phase.phase === "blocked"
                          ? "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300"
                          : phase.phase === "ready"
                            ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300"
                            : phase.phase === "onboarding"
                              ? "bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300"
                              : "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300",
                      )}>
                        {phase.nextActionLabel}
                      </span>
                    </div>
                  </Link>
                </MotionItem>
              );
            })}
            </MotionList>
          </div>
        )}
      </LifecycleSection>

      {/* ─── DISCHARGES SECTION ─── */}
      <LifecycleSection
        title="Discharges"
        color="rose"
        icon={DoorOpen}
        allHref="/admin/discharge"
        metrics={[
          { label: "Draft", value: noFacility ? "—" : loading ? "—" : dischargeCounts.draft },
          { label: "In Review", value: noFacility ? "—" : loading ? "—" : dischargeCounts.review },
          { label: "Complete", value: noFacility ? "—" : loading ? "—" : dischargeCounts.complete },
        ]}
      >
        {noFacility ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Select a facility to view discharges.</p>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Loading...</p>
        ) : discharges.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
            No active reconciliations. <Link href="/admin/discharge/new" className="underline text-rose-600 dark:text-rose-400">Start a discharge</Link>.
          </p>
        ) : (
          <MotionList className="space-y-3">
            {featuredDischarges.map((r) => {
              const isDraft = r.status === "draft";
              const phase = describeDischargePhase(r);
              return (
                <MotionItem key={r.id}>
                  <Link
                    href={`/admin/discharge/${r.id}`}
                    className="flex items-center gap-3 p-4 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 hover:border-rose-200 dark:hover:border-rose-500/30 transition-all duration-300 w-full cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                      {isDraft ? <PulseDot colorClass="bg-rose-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                          {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "Unlinked reconciliation"}
                        </span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border",
                          isDraft
                            ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                            : r.status === "pharmacist_review"
                              ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        )}>
                          {formatStatus(r.status)}
                        </span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border",
                          phase.phase === "planning"
                            ? "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300"
                            : phase.phase === "pharmacist_review"
                              ? "bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300"
                              : phase.phase === "ready_to_complete"
                                ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300"
                                : "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300",
                        )}>
                          {phase.nextActionLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
                        Updated {formatRelative(r.updated_at)}
                      </p>
                      <p className={cn(
                        "mt-1 text-[11px]",
                        phase.phase === "planning"
                          ? "text-amber-700 dark:text-amber-300"
                          : phase.phase === "pharmacist_review"
                            ? "text-indigo-700 dark:text-indigo-300"
                            : phase.phase === "ready_to_complete"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-slate-600 dark:text-zinc-400",
                      )}>
                        {phase.helperText}
                      </p>
                    </div>
                  </Link>
                </MotionItem>
              );
            })}
          </MotionList>
        )}
      </LifecycleSection>

      {/* ─── FAMILY CONNECTIONS SECTION ─── */}
      <LifecycleSection
        title="Family Connections"
        color="amber"
        icon={MessageCircle}
        allHref="/admin/family-portal"
        metrics={[
          { label: "Triage Alerts", value: noFacility ? "—" : loading ? "—" : familyCounts.triage },
          { label: "Upcoming Conferences", value: noFacility ? "—" : loading ? "—" : familyCounts.conferences },
          { label: "Consents", value: noFacility ? "—" : loading ? "—" : familyCounts.consents },
        ]}
      >
        {noFacility ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Select a facility to view family connections.</p>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500">Loading...</p>
        ) : triage.length === 0 && conferences.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
            No items needing attention. View <Link href="/admin/family-messages" className="underline text-amber-600 dark:text-amber-400">direct messages</Link> for all conversations.
          </p>
        ) : (
          <MotionList className="space-y-3">
            {/* Triage alerts first */}
            {triage.map((t) => (
              <MotionItem key={`triage-${t.id}`}>
                <Link
                  href="/admin/family-portal"
                  className="flex items-center gap-3 p-4 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 hover:border-rose-200 dark:hover:border-rose-500/30 transition-all duration-300 w-full cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 flex items-center justify-center shrink-0">
                    <PulseDot colorClass="bg-rose-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                        {t.residents ? `${t.residents.first_name} ${t.residents.last_name}` : "Unknown resident"}
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border-rose-500/20">
                        Triage Alert
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5 truncate">
                      {t.matched_keywords?.join(", ") ?? "Keywords detected"} · {formatRelative(t.updated_at)}
                    </p>
                  </div>
                </Link>
              </MotionItem>
            ))}
            {/* Upcoming conferences */}
            {conferences.map((c) => (
              <MotionItem key={`conf-${c.id}`}>
                <Link
                  href="/admin/family-portal"
                  className="flex items-center gap-3 p-4 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 w-full cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {c.residents ? `${c.residents.first_name} ${c.residents.last_name}` : "Unknown resident"}
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border-indigo-500/20">
                        Conference
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
                      {c.scheduled_start ? new Date(c.scheduled_start).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"} · {formatRelative(c.updated_at)}
                    </p>
                  </div>
                </Link>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </LifecycleSection>
    </div>
  );
}
