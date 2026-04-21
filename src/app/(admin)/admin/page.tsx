"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, ShieldAlert, Pill, FileWarning, CheckCircle2, UserCog, HeartPulse, Activity, Zap, Users, DoorOpen, NotebookPen, ClipboardList, ArrowRightLeft, MessageCircle, type LucideIcon } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminDashboardSnapshot, type AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { useDashboardSnapshotCache } from "@/stores/dashboard-snapshot-cache";
import { cn } from "@/lib/utils";

import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { MotionCard } from "@/components/ui/motion-card";

type LocalInboxItem = {
  id: string;
  label: string;
  message: string;
  tone: "warning";
  href: string;
  ctaLabel: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, loading: authLoading } = useHavenAuth();
  const getFreshSnapshot = useDashboardSnapshotCache((s) => s.getFresh);
  const setSnapshotCache = useDashboardSnapshotCache((s) => s.setEntry);
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (authLoading) return;

    setError(null);
    const config = getRoleDashboardConfig(appRole);

    if (appRole === "caregiver" || appRole === "housekeeper" || appRole === "family") {
      router.replace(config.route);
      setIsLoading(false);
      return;
    }

    if (config.route !== "/admin") {
      router.replace(config.route);
      setIsLoading(false);
      return;
    }

    const cached = getFreshSnapshot(selectedFacilityId);
    if (cached) {
      setSnapshot(cached);
      setIsLoading(false);
      try {
        const data = await fetchAdminDashboardSnapshot(selectedFacilityId);
        setSnapshotCache(selectedFacilityId, data);
        setSnapshot(data);
      } catch {
        /* keep showing cached snapshot */
      }
      return;
    }

    setIsLoading(true);
    try {
      const data = await fetchAdminDashboardSnapshot(selectedFacilityId);
      setSnapshotCache(selectedFacilityId, data);
      setSnapshot(data);
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : "Unable to load triage metrics.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, router, authLoading, appRole, getFreshSnapshot, setSnapshotCache]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-8 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-10 w-64 mb-3 rounded-xl bg-slate-200 dark:bg-white/5" />
            <Skeleton className="h-5 w-48 rounded-lg bg-slate-200 dark:bg-white/5" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-36 w-full rounded-[2rem] bg-slate-200 dark:bg-white/5" />
          <Skeleton className="h-36 w-full rounded-[2rem] bg-slate-200 dark:bg-white/5" />
          <Skeleton className="h-36 w-full rounded-[2rem] bg-slate-200 dark:bg-white/5" />
          <Skeleton className="h-36 w-full rounded-[2rem] bg-slate-200 dark:bg-white/5" />
        </div>
        <Skeleton className="h-[500px] w-full rounded-[2.5rem] bg-slate-200 dark:bg-white/5" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center p-10 bg-amber-50/50 dark:bg-amber-950/20 rounded-[2.5rem] border border-amber-200 dark:border-amber-900/30 max-w-lg backdrop-blur-xl shadow-2xl">
          <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-amber-400/50">
             <AlertCircle className="w-10 h-10 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-2xl font-display font-light text-amber-800 dark:text-amber-300 mb-3 tracking-tight">Triage Unavailable</h2>
          <p className="text-amber-700/80 dark:text-amber-400/80 mb-8 leading-relaxed font-medium">{error ?? "Unable to load operational queues safely. Please refresh."}</p>
          <button 
             onClick={() => void load()}
             className="h-14 px-8 rounded-2xl flex items-center justify-center font-bold tracking-wide transition-all shadow-[0_4px_20px_rgba(245,158,11,0.15)] bg-amber-500 text-amber-950 hover:bg-amber-400 tap-responsive mx-auto"
          >
             RETRY CONNECTION
          </button>
        </div>
      </div>
    );
  }

  const openIncidents = snapshot.openIncidentAlerts;
  const staffingGaps = snapshot.staffingGapSnapshots24h;
  const medExceptions = snapshot.medicationErrorsUnreviewed;
  const complianceAlerts = snapshot.expiringCertifications30d;
  const scopeLabel = snapshot.headlineName === "All facilities" ? "Global Triage Queue" : "Facility Triage Queue";
  const triageInboxItems: LocalInboxItem[] = [
    staffingGaps > 0
      ? {
          id: "staffing-gaps",
          label: "Staffing Gaps",
          message: `${staffingGaps} non-compliant staffing snapshot${staffingGaps === 1 ? "" : "s"} need review.`,
          tone: "warning",
          href: "/admin/staffing?compliance=non_compliant&window=24h",
          ctaLabel: "Review staffing gaps",
        }
      : null,
    medExceptions > 0
      ? {
          id: "med-exceptions",
          label: "Med Exceptions",
          message: `${medExceptions} unreviewed medication error${medExceptions === 1 ? "" : "s"} need follow-up.`,
          tone: "warning",
          href: "/admin/medications/errors?review=unreviewed",
          ctaLabel: "Review unreviewed errors",
        }
      : null,
    complianceAlerts > 0
      ? {
          id: "compliance-risks",
          label: "Compliance Risks",
          message: `${complianceAlerts} certification${complianceAlerts === 1 ? "" : "s"} are expiring within 30 days.`,
          tone: "warning",
          href: "/admin/certifications?timeline=expiring_soon&dbStatus=active&window=30d",
          ctaLabel: "Review expiring credentials",
        }
      : null,
  ].filter((item): item is LocalInboxItem => item !== null);
  const workflows = snapshot.workflowQueues;
  const assurance = snapshot.residentAssurance;
  const topStripActionable = staffingGaps + medExceptions + complianceAlerts;
  const incidentLifecycleBacklog =
    workflows.incidentOpenObligations + workflows.incidentRootCausePending + workflows.incidentCarePlanPending;
  const incidentFollowupBacklog =
    workflows.incidentEscalatedFollowups + workflows.incidentOverdueFollowups + workflows.incidentUnassignedFollowups;
  const incidentPrimaryHref =
    incidentLifecycleBacklog > 0
      ? "/admin/incidents/obligations"
      : workflows.incidentEscalatedFollowups > 0
        ? "/admin/incidents/followups?filter=escalated"
        : workflows.incidentOverdueFollowups > 0
          ? "/admin/incidents/overdue-followups"
          : workflows.incidentUnassignedFollowups > 0
            ? "/admin/incidents/followups?filter=unassigned"
            : "/admin/incidents/followups";
  const incidentPrimaryValue =
    incidentLifecycleBacklog > 0
      ? incidentLifecycleBacklog
      : workflows.incidentEscalatedFollowups > 0
        ? workflows.incidentEscalatedFollowups
        : workflows.incidentOverdueFollowups;
  const doctrinePrimaryHref =
    workflows.doctrineOverdue > 0 || workflows.doctrineDueSoon > 0
      ? "/admin/knowledge/admin#doctrine-review-sla"
      : workflows.doctrineReadyToPublish > 0
        ? "/admin/knowledge/admin#doctrine-ready-to-publish"
        : "/admin/knowledge/admin#doctrine-blocked-review";
  const doctrinePrimaryTitle =
    workflows.doctrineOverdue > 0 || workflows.doctrineDueSoon > 0
      ? "Doctrine SLA"
      : workflows.doctrineReadyToPublish > 0
        ? "Ready To Publish"
        : "Doctrine Review";
  const doctrinePrimaryValue =
    workflows.doctrineOverdue > 0
      ? workflows.doctrineOverdue
      : workflows.doctrineBlockedReview > 0
        ? workflows.doctrineBlockedReview
        : workflows.doctrineReadyToPublish > 0
          ? workflows.doctrineReadyToPublish
          : workflows.doctrineDueSoon;
  const admissionsPrimaryHref =
    workflows.admissionsBlocked > 0
      ? "/admin/admissions/blocked"
      : workflows.admissionsOnboardingPending > 0
        ? "/admin/admissions/onboarding"
        : "/admin/admissions/move-in-ready";
  const admissionsPrimaryValue =
    workflows.admissionsBlocked > 0
      ? workflows.admissionsBlocked
      : workflows.admissionsOnboardingPending > 0
        ? workflows.admissionsOnboardingPending
        : workflows.admissionsMoveInReady;
  const admissionsPrimaryTitle =
    workflows.admissionsBlocked > 0
      ? "Admissions Backlog"
      : workflows.admissionsOnboardingPending > 0
        ? "Admissions Onboarding"
        : "Move-In Ready";
  const referralPrimaryValue =
    workflows.referralsBlockedHandoffs > 0
      ? workflows.referralsBlockedHandoffs
      : workflows.referralsOnboardingHandoffs > 0
        ? workflows.referralsOnboardingHandoffs
        : workflows.referralsReadyHandoffs > 0
          ? workflows.referralsReadyHandoffs
          : workflows.referralsInAdmissions;
  const referralPrimaryTitle =
    workflows.referralsBlockedHandoffs > 0
      ? "Referral Blockers"
      : workflows.referralsOnboardingHandoffs > 0
        ? "Referral Onboarding"
        : "Referral Handoffs";
  const referralPrimaryHref =
    workflows.referralsBlockedHandoffs > 0
      ? "/admin/referrals/in-admissions?phase=blocked"
      : workflows.referralsOnboardingHandoffs > 0
        ? "/admin/referrals/in-admissions?phase=onboarding"
        : "/admin/referrals/in-admissions?phase=ready";
  const familyPrimaryHref =
    workflows.familyTriagePending > 0
      ? "/admin/family-messages?filter=triage"
      : "/admin/family-portal?conference=upcoming#care-conferences";
  const familyPrimaryTitle =
    workflows.familyTriagePending > 0 ? "Family Triage" : "Care Conferences";
  const familyPrimaryValue =
    workflows.familyTriagePending > 0 ? workflows.familyTriagePending : workflows.familyConferencesUpcoming;
  const dischargePrimaryHref =
    workflows.dischargePlanning > 0
      ? "/admin/discharge?phase=planning"
      : workflows.dischargePharmacistReview > 0
        ? "/admin/discharge?phase=pharmacist_review"
        : "/admin/discharge?phase=ready_to_complete";
  const dischargePrimaryTitle =
    workflows.dischargePlanning > 0
      ? "Discharge Planning"
      : workflows.dischargePharmacistReview > 0
        ? "Pharmacist Review"
        : "Ready To Complete";
  const dischargePrimaryValue =
    workflows.dischargePlanning > 0
      ? workflows.dischargePlanning
      : workflows.dischargePharmacistReview > 0
        ? workflows.dischargePharmacistReview
        : workflows.dischargeReadyToComplete;
  const totalActionable =
    topStripActionable +
    workflows.doctrineBlockedReview +
    workflows.doctrineReadyToPublish +
    workflows.doctrineDueSoon +
    workflows.doctrineOverdue +
    workflows.incidentOverdueFollowups +
    workflows.incidentUnassignedFollowups +
    workflows.incidentEscalatedFollowups +
    workflows.incidentOpenObligations +
    workflows.incidentRootCausePending +
    workflows.incidentCarePlanPending +
    workflows.admissionsBlocked +
    workflows.admissionsOnboardingPending +
    workflows.referralsBlockedHandoffs +
    workflows.referralsReadyHandoffs +
    workflows.referralsOnboardingHandoffs +
    workflows.dischargePlanning +
    workflows.dischargePharmacistReview +
    workflows.dischargeReadyToComplete +
    workflows.familyTriagePending +
    workflows.familyConferencesUpcoming +
    assurance.pendingWatchApprovals +
    assurance.openEscalations +
    assurance.openIntegrityFlags +
    assurance.criticalSafetyResidents;
  const adminConfig = getRoleDashboardConfig(appRole);

  return (
    <div className="space-y-10 pb-12 overflow-x-hidden">
      
      {/* ─── PAGE HEADER MOONSHOT ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-100/50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-[10px] font-bold uppercase tracking-widest text-indigo-800 dark:text-indigo-300 mb-2">
             <Zap className="w-3.5 h-3.5" /> Operations Hub
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
            Command Center
          </h1>
          <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
            {snapshot.headlineName} &middot; <span className="opacity-70 dark:opacity-50">{scopeLabel}</span>
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
            {adminConfig.roleLabel} home: work urgent facility actions first, then clear blocked workflows, then move into resident watchlist and recent critical activity.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="glass-panel px-5 py-3 rounded-2xl border border-slate-200/50 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-zinc-300 flex items-center justify-center gap-3 w-full sm:w-auto shadow-sm bg-white/60 dark:bg-white/[0.02]">
            <Clock className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            <div className="flex flex-col items-start leading-tight">
               <span className="opacity-60 text-[10px] uppercase tracking-widest">Active Shift</span>
               <span>{snapshot.shiftSummary}</span>
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-2" />
            <div className="flex flex-col items-start leading-tight">
               <span className="opacity-60 text-[10px] uppercase tracking-widest">Zone</span>
               <span>{snapshot.timezoneLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200/60 bg-white/60 p-5 shadow-sm backdrop-blur-3xl dark:border-white/5 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">Facility Priorities</p>
            <h2 className="mt-1 text-lg font-display font-medium text-slate-900 dark:text-white">
              {adminConfig.firstScreenPriority.join(" · ").replace(/_/g, " ")}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {adminConfig.primaryTaskLanes.map((lane) => (
              <span
                key={lane}
                className="rounded-full border border-slate-200/70 bg-slate-100/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400"
              >
                {lane.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ─── FLOATING TRIAGE CARDS ────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
          <div>
            <h2 className="text-xl font-display font-medium text-slate-900 dark:text-white">Urgent Now</h2>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">The fastest route into facility-day exceptions that need immediate review.</p>
          </div>
        </div>
      <MotionList className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MotionItem>
          <TriageMetricCard 
            title="Open Incidents" 
            value={openIncidents} 
            icon={ShieldAlert}
            href="/admin/incidents?scope=open"
            urgency={openIncidents > 0 ? "critical" : "normal"} 
            subLabel={openIncidents > 0 ? "Open / investigating" : "No open incidents"}
          />
        </MotionItem>
        <MotionItem>
          <TriageMetricCard 
            title="Staffing Gaps" 
            value={staffingGaps} 
            icon={UserCog}
            href="/admin/staffing?compliance=non_compliant&window=24h"
            urgency={staffingGaps > 0 ? "high" : "normal"} 
            subLabel="Non-compliant snapshots (24h)"
          />
        </MotionItem>
        <MotionItem>
          <TriageMetricCard 
            title="Med Exceptions" 
            value={medExceptions} 
            icon={Pill}
            href="/admin/medications/errors?review=unreviewed"
            urgency={medExceptions > 0 ? "medium" : "normal"} 
            subLabel="Unreviewed medication errors"
          />
        </MotionItem>
        <MotionItem>
          <TriageMetricCard 
            title="Compliance Risks" 
            value={complianceAlerts} 
            icon={FileWarning}
            href="/admin/certifications?timeline=expiring_soon&dbStatus=active&window=30d"
            urgency={complianceAlerts > 0 ? "high" : "normal"} 
            subLabel="Certifications expiring (30d)"
          />
        </MotionItem>
      </MotionList>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">Blocked Workflows</p>
            <h2 className="text-xl font-display font-medium text-slate-900 dark:text-white">Workflow Convergence</h2>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Cross-lane backlog state across doctrine, incidents, admissions, referrals, discharge, and family workflows.</p>
          </div>
        </div>
        <MotionList className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MotionItem>
            <TriageMetricCard
              title={doctrinePrimaryTitle}
              value={doctrinePrimaryValue}
              icon={NotebookPen}
              href={doctrinePrimaryHref}
              urgency={workflows.doctrineOverdue > 0 ? "critical" : workflows.doctrineBlockedReview > 0 || workflows.doctrineDueSoon > 0 ? "high" : "normal"}
              subLabel={`${workflows.doctrineBlockedReview} blocked · ${workflows.doctrineReadyToPublish} ready · ${workflows.doctrineDueSoon} due soon`}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title={incidentLifecycleBacklog > 0 ? "Incident Lifecycle" : "Incident Follow-Ups"}
              value={incidentPrimaryValue}
              icon={ClipboardList}
              href={incidentPrimaryHref}
              urgency={
                workflows.incidentEscalatedFollowups > 0 || workflows.incidentOpenObligations > 0
                  ? "critical"
                  : workflows.incidentOverdueFollowups > 0 || workflows.incidentRootCausePending > 0 || workflows.incidentCarePlanPending > 0 || workflows.incidentUnassignedFollowups > 0
                    ? "high"
                    : "normal"
              }
              subLabel={`${workflows.incidentOverdueFollowups} overdue · ${workflows.incidentOpenObligations} obligations · ${workflows.incidentRootCausePending} RCA`}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title={admissionsPrimaryTitle}
              value={admissionsPrimaryValue}
              icon={DoorOpen}
              href={admissionsPrimaryHref}
              urgency={workflows.admissionsBlocked > 0 ? "high" : workflows.admissionsOnboardingPending > 0 ? "medium" : "normal"}
              subLabel={`${workflows.admissionsMoveInReady} ready · ${workflows.admissionsOnboardingPending} onboarding`}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title={referralPrimaryTitle}
              value={referralPrimaryValue}
              icon={ArrowRightLeft}
              href={referralPrimaryHref}
              urgency={workflows.referralsBlockedHandoffs > 0 ? "high" : workflows.referralsInAdmissions > 0 ? "medium" : "normal"}
              subLabel={`${workflows.referralsBlockedHandoffs} blocked · ${workflows.referralsReadyHandoffs} ready · ${workflows.referralsOnboardingHandoffs} onboarding`}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title={dischargePrimaryTitle}
              value={dischargePrimaryValue}
              icon={DoorOpen}
              href={dischargePrimaryHref}
              urgency={workflows.dischargePlanning > 0 ? "high" : workflows.dischargePharmacistReview > 0 ? "medium" : workflows.dischargeReadyToComplete > 0 ? "normal" : "normal"}
              subLabel={`${workflows.dischargePlanning} planning · ${workflows.dischargePharmacistReview} pharmacist · ${workflows.dischargeReadyToComplete} ready`}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title={familyPrimaryTitle}
              value={familyPrimaryValue}
              icon={MessageCircle}
              href={familyPrimaryHref}
              urgency={workflows.familyTriagePending > 0 ? "high" : workflows.familyConferencesUpcoming > 0 ? "medium" : "normal"}
              subLabel={`${workflows.familyTriagePending} triage · ${workflows.familyConferencesUpcoming} conferences`}
            />
          </MotionItem>
        </MotionList>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">Resident Assurance</p>
            <h2 className="text-xl font-display font-medium text-slate-900 dark:text-white">Safety Command Rollup</h2>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Watch load, escalation pressure, integrity review, and safety-score risk in one lane.</p>
          </div>
        </div>
        <MotionList className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MotionItem>
            <TriageMetricCard
              title="Watch Center"
              value={assurance.activeWatches > 0 ? assurance.activeWatches : assurance.pendingWatchApprovals}
              icon={ShieldAlert}
              href={assurance.pendingWatchApprovals > 0 ? "/admin/rounding/watches" : "/admin/rounding/watches"}
              urgency={assurance.pendingWatchApprovals > 0 ? "high" : assurance.activeWatches > 0 ? "medium" : "normal"}
              subLabel={`${assurance.activeWatches} active · ${assurance.pendingWatchApprovals} pending approval`}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title="Escalation Queue"
              value={assurance.openEscalations}
              icon={AlertCircle}
              href="/admin/rounding/escalations"
              urgency={assurance.openEscalations > 0 ? "critical" : "normal"}
              subLabel={assurance.openEscalations > 0 ? "Overdue or missed checks need review" : "No active escalations"}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title="Integrity Review"
              value={assurance.openIntegrityFlags}
              icon={NotebookPen}
              href="/admin/rounding/integrity"
              urgency={assurance.openIntegrityFlags > 0 ? "high" : "normal"}
              subLabel={assurance.openIntegrityFlags > 0 ? "Late-entry and evidence flags open" : "No open integrity flags"}
            />
          </MotionItem>
          <MotionItem>
            <TriageMetricCard
              title="Safety Scores"
              value={assurance.criticalSafetyResidents}
              icon={HeartPulse}
              href="/admin/rounding/safety"
              urgency={assurance.criticalSafetyResidents > 0 ? "critical" : assurance.highOrCriticalSafetyResidents > 0 ? "high" : "normal"}
              subLabel={`${assurance.highOrCriticalSafetyResidents} high or critical residents`}
            />
          </MotionItem>
        </MotionList>
      </div>

      <div className="grid gap-8 lg:grid-cols-3 items-start">
        
        {/* ─── INBOX FEED ──────────────────────────────────────────────────────── */}
        <MotionCard delay={0.2} className="col-span-2">
          <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.02] shadow-sm backdrop-blur-3xl overflow-hidden relative">
            <div className="p-8 pb-4 flex flex-row items-center justify-between border-b border-slate-100 dark:border-white/5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">Recent Critical Activity</p>
                <h2 className="mt-1 text-2xl font-display font-medium text-slate-900 dark:text-white flex items-center gap-3">
                  <Activity className="w-6 h-6 text-indigo-500" />
                  Primary Inbox
                  {totalActionable > 0 && (
                    <span className="px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-bold tracking-widest font-mono border border-rose-200 dark:border-rose-500/30">
                      {totalActionable} ACTIONABLE
                    </span>
                  )}
                </h2>
                <p className="text-slate-500 dark:text-zinc-400 text-sm mt-1.5 font-medium tracking-wide">
                   Requires administrative intervention or sign-off.
                </p>
              </div>
            </div>
            
            <div className="p-4 md:p-6 bg-slate-50/50 dark:bg-transparent">
              {snapshot.workflowInbox.length === 0 && triageInboxItems.length === 0 && snapshot.activity.length === 0 && openIncidents === 0 ? (
                <div className="p-16 text-center text-slate-500 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[2rem]">
                  <CheckCircle2 className="w-16 h-16 text-emerald-400 mb-6 opacity-30" />
                  <p className="text-xl font-display text-slate-800 dark:text-zinc-200 mb-2">Inbox Zero</p>
                  <p className="text-sm font-medium opacity-80 tracking-wide">All operational exceptions resolved.</p>
                </div>
              ) : (
                <MotionList className="space-y-3">
                  {triageInboxItems.map((item) => {
                    return (
                      <MotionItem key={item.id} className="glass-card p-5 md:p-6 rounded-[1.5rem] transition-all bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30 shadow-[inset_0_0_30px_rgba(245,158,11,0.05)] hover:bg-amber-50 dark:hover:bg-amber-950/30">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest border bg-amber-200/50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-400 border-amber-300/50 dark:border-amber-500/30">
                                {item.label}
                              </span>
                              <span className="text-xs font-semibold text-slate-500 dark:text-zinc-500 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> Triage strip
                              </span>
                            </div>
                            <p className="text-base font-medium text-slate-900 dark:text-slate-100">
                              {item.message}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <Link href={item.href} className="h-12 px-6 bg-slate-900 dark:bg-white text-white dark:text-black rounded-xl font-semibold tracking-wide flex items-center justify-center hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shadow-lg">
                              {item.ctaLabel}
                            </Link>
                          </div>
                        </div>
                      </MotionItem>
                    );
                  })}
                  {snapshot.workflowInbox.map((item) => {
                    const isCrit = item.tone === "critical";
                    return (
                      <MotionItem key={item.id} className={`glass-card p-5 md:p-6 rounded-[1.5rem] transition-all ${
                        isCrit
                          ? "bg-rose-50/50 dark:bg-rose-950/10 border-rose-200 dark:border-rose-500/30 shadow-[inset_0_0_40px_rgba(225,29,72,0.03)] hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          : item.tone === "warning"
                            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30 shadow-[inset_0_0_30px_rgba(245,158,11,0.05)] hover:bg-amber-50 dark:hover:bg-amber-950/30"
                            : "bg-white/80 dark:bg-white/[0.015] border-slate-200 dark:border-white/5 shadow-sm hover:bg-white dark:hover:bg-white/[0.03]"
                      }`}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                             <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest border ${
                                isCrit
                                  ? "bg-rose-200/50 dark:bg-rose-500/20 text-rose-800 dark:text-rose-400 border-rose-300/50 dark:border-rose-500/30"
                                  : item.tone === "warning"
                                    ? "bg-amber-200/50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-400 border-amber-300/50 dark:border-amber-500/30"
                                    : "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-zinc-400 border-slate-200 lg:border-white/10"
                             }`}>
                                {item.label}
                             </span>
                             <span className="text-xs font-semibold text-slate-500 dark:text-zinc-500 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> Workflow backlog
                             </span>
                          </div>
                          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
                             {item.message}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Link href={item.href} className="h-12 px-6 bg-slate-900 dark:bg-white text-white dark:text-black rounded-xl font-semibold tracking-wide flex items-center justify-center hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shadow-lg">
                            {item.ctaLabel}
                          </Link>
                        </div>
                      </div>
                    </MotionItem>
                    );
                  })}

                  {snapshot.activity.filter(a => a.tone === "critical" || a.tone === "warning").map(event => {
                     const isCrit = event.tone === "critical";
                     return (
                        <MotionItem key={event.id} className={`glass-card p-5 md:p-6 rounded-[1.5rem] transition-all ${
                          isCrit 
                            ? "bg-rose-50/50 dark:bg-rose-950/10 border-rose-200 dark:border-rose-500/30 shadow-[inset_0_0_40px_rgba(225,29,72,0.03)] hover:bg-rose-50 dark:hover:bg-rose-950/20"
                            : "bg-white/80 dark:bg-white/[0.015] border-slate-200 dark:border-white/5 shadow-sm hover:bg-white dark:hover:bg-white/[0.03]"
                        }`}>
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 mb-2">
                                 <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest border ${
                                    isCrit ? "bg-rose-200/50 dark:bg-rose-500/20 text-rose-800 dark:text-rose-400 border-rose-300/50 dark:border-rose-500/30" : "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-zinc-400 border-slate-200 lg:border-white/10"
                                 }`}>
                                    {event.actor}
                                 </span>
                                 <span className="text-xs font-semibold text-slate-500 dark:text-zinc-500 flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5" /> {event.timeLabel}
                                 </span>
                              </div>
                              <p className="text-base font-medium text-slate-900 dark:text-slate-100">
                                 {event.message}
                              </p>
                            </div>
                            <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
                              <Link href={event.href} className={`h-11 px-5 rounded-xl font-semibold tracking-wide flex items-center justify-center transition-colors border shadow-sm ${
                                isCrit ? "bg-white dark:bg-stone-900 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-stone-800" : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-white/10"
                              }`}>
                                {event.ctaLabel}
                              </Link>
                            </div>
                          </div>
                        </MotionItem>
                     )
                  })}
                </MotionList>
              )}
            </div>
          </div>
        </MotionCard>
        
        {/* ─── SIDEBAR & CAPACITY ──────────────────────────────────────────────── */}
        <div className="space-y-6">
          <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.01] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">Resident Watchlist</p>
            <h3 className="mt-1 text-xl font-display font-medium text-slate-900 dark:text-white mb-6 flex items-center justify-between">
               Acuity Watchlist
               <Link href="/admin/residents?acuity=watchlist" className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:underline">Watchlist Roster</Link>
            </h3>
            
            <div className="space-y-3">
               {snapshot.acuityWatchlist.map(res => (
                  <Link
                    key={res.id}
                    href={`/admin/residents/${res.id}`}
                    className="flex items-center justify-between p-4 rounded-[1.5rem] bg-white border border-slate-100 dark:bg-white/[0.03] dark:border-white/5 shadow-sm tap-responsive group hover:border-slate-300 dark:hover:border-white/10 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <div className="flex items-center gap-4 overflow-hidden">
                      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                         <span className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">{res.initials}</span>
                      </div>
                      <div className="flex flex-col truncate">
                        <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">{res.name}</span>
                        <span className="text-xs font-medium text-slate-500 dark:text-zinc-500">Room {res.room}</span>
                      </div>
                    </div>
                    {res.acuity === 3 ? (
                      <span className="px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 text-[9px] font-black uppercase tracking-widest leading-none">Critical</span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 text-[9px] font-black uppercase tracking-widest leading-none">OBSV</span>
                    )}
                  </Link>
               ))}
               {snapshot.acuityWatchlist.length === 0 && (
                 <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-[1.5rem]">
                   <p className="text-sm font-medium text-slate-500">No high acuity residents currently.</p>
                 </div>
               )}
            </div>
          </div>
          
          <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/80 dark:bg-white/[0.015] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
             <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">Capacity Follow-through</p>
             <h3 className="mt-1 text-xl font-display font-medium text-slate-900 dark:text-white mb-6">
                Pipeline & Capacity
             </h3>
             <div className="space-y-4">
                <Link href="/admin/residents?status=active" className="block">
                  <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5 shadow-inner transition-colors hover:bg-white dark:hover:bg-black/50">
                    <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                       <Users className="w-4 h-4" /> Total Census
                    </span>
                    <span className="text-2xl font-display font-medium text-slate-900 dark:text-white tabular-nums">
                      {snapshot.licensedBeds ? `${snapshot.residentCount} / ${snapshot.licensedBeds}` : snapshot.residentCount}
                    </span>
                  </div>
                </Link>
                <Link href="/admin/admissions/blocked" className="block">
                  <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5 shadow-inner transition-colors hover:bg-white dark:hover:bg-black/50">
                    <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                       <DoorOpen className="w-4 h-4" /> Blocked Admissions
                    </span>
                    <span className="text-2xl font-display font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                      {workflows.admissionsBlocked}
                    </span>
                  </div>
                </Link>
                <Link href="/admin/admissions/move-in-ready" className="block">
                  <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5 shadow-inner transition-colors hover:bg-white dark:hover:bg-black/50">
                    <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                       <CheckCircle2 className="w-4 h-4" /> Move-In Ready
                    </span>
                    <span className="text-2xl font-display font-medium text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {workflows.admissionsMoveInReady}
                    </span>
                  </div>
                </Link>
                <Link href="/admin/admissions/onboarding" className="block">
                  <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5 shadow-inner transition-colors hover:bg-white dark:hover:bg-black/50">
                    <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                       <HeartPulse className="w-4 h-4" /> Onboarding Pending
                    </span>
                    <span className="text-2xl font-display font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                      {workflows.admissionsOnboardingPending}
                    </span>
                  </div>
                </Link>
                <Link href={referralPrimaryHref} className="block">
                  <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5 shadow-inner transition-colors hover:bg-white dark:hover:bg-black/50">
                    <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                       <ArrowRightLeft className="w-4 h-4" /> {referralPrimaryTitle}
                    </span>
                    <span className="text-2xl font-display font-medium text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {referralPrimaryValue}
                    </span>
                  </div>
                </Link>
                <Link href="/admin/residents?status=away" className="block">
                  <div className="flex justify-between items-center bg-white dark:bg-black/40 p-5 rounded-[1.5rem] border border-slate-100 dark:border-white/5 shadow-inner transition-colors hover:bg-white dark:hover:bg-black/50">
                    <span className="text-[13px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                       <HeartPulse className="w-4 h-4" /> LOA / Hospital
                    </span>
                    <span className="text-2xl font-display font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                      {snapshot.awayResidentCount}
                    </span>
                  </div>
                </Link>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TriageMetricCard({
  title, value, icon: Icon, urgency, subLabel, href
}: {
  title: string; value: number; icon: LucideIcon; urgency: "critical" | "high" | "medium" | "normal"; subLabel: string; href: string
}) {
  const urgencyClass = {
    critical: "bg-rose-50/80 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/30 shadow-[0_8px_30px_rgba(225,29,72,0.1)] group-hover:bg-rose-100/80 dark:group-hover:bg-rose-950/40",
    high: "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30 shadow-[0_8px_30px_rgba(245,158,11,0.08)] group-hover:bg-amber-100/80 dark:group-hover:bg-amber-950/40",
    medium: "bg-indigo-50/80 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/30 shadow-[0_8px_30px_rgba(99,102,241,0.08)] group-hover:bg-indigo-100/80 dark:group-hover:bg-indigo-950/40",
    normal: "bg-white/60 dark:bg-white/[0.02] border-slate-200 dark:border-white/5 shadow-sm group-hover:bg-white dark:group-hover:bg-white/[0.05]"
  };

  const textClass = {
    critical: "text-rose-700 dark:text-rose-400",
    high: "text-amber-700 dark:text-amber-400",
    medium: "text-indigo-700 dark:text-indigo-400",
    normal: "text-slate-800 dark:text-zinc-200"
  };
  
  const iconBg = {
    critical: "bg-rose-100 dark:bg-rose-900/50 border-rose-200 dark:border-rose-500/50 text-rose-600 dark:text-rose-300",
    high: "bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-500/50 text-amber-600 dark:text-amber-300",
    medium: "bg-indigo-100 dark:bg-indigo-900/50 border-indigo-200 dark:border-indigo-500/50 text-indigo-600 dark:text-indigo-300",
    normal: "bg-slate-100 dark:bg-white/10 border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-400"
  };

  return (
    <Link href={href} className="block group outline-none tap-responsive">
      <div className={cn(
        "relative rounded-[2rem] p-6 lg:p-8 flex flex-col justify-between transition-all duration-300 border backdrop-blur-2xl overflow-hidden h-full min-h-[160px]", 
        urgencyClass[urgency]
      )}>
        {urgency !== 'normal' && (
           <div className={`absolute -right-10 -top-10 w-40 h-40 rounded-full blur-[50px] opacity-20 pointer-events-none transition-transform duration-700 group-hover:scale-150 ${urgency === 'critical' ? 'bg-rose-500' : urgency === 'high' ? 'bg-amber-500' : 'bg-indigo-500'}`} />
        )}
        
        <div className="flex items-start justify-between z-10">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 max-w-[60%] leading-tight">
            {title}
          </span>
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner shrink-0",
            iconBg[urgency]
          )}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
        
        <div className="flex flex-col gap-1 mt-4 z-10">
          <span className={cn("text-5xl lg:text-6xl font-display font-medium tabular-nums tracking-tight leading-none", textClass[urgency])}>
            {value}
          </span>
          <span className="text-xs font-semibold text-slate-600/80 dark:text-zinc-500 tracking-wide mt-1">
             {subLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
