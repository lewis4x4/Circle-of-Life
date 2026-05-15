"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, ShieldAlert, Pill, FileWarning, CheckCircle2, UserCog, HeartPulse, Activity, Users, DoorOpen, NotebookPen, ClipboardList, ArrowRightLeft, MessageCircle, type LucideIcon } from "lucide-react";
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

type AdminDashboardPageClientProps = {
  initialSnapshot: AdminDashboardSnapshot | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

export function AdminDashboardPageClient({
  initialSnapshot,
  initialError,
  initialFacilityId,
}: AdminDashboardPageClientProps) {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const { appRole, loading: authLoading } = useHavenAuth();
  const getFreshSnapshot = useDashboardSnapshotCache((s) => s.getFresh);
  const setSnapshotCache = useDashboardSnapshotCache((s) => s.setEntry);
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(initialSnapshot);
  const [isLoading, setIsLoading] = useState(initialSnapshot == null && initialError == null);
  const [error, setError] = useState<string | null>(initialError);

  // Prime the cross-nav cache with the server-rendered snapshot so clicks away
  // and back hit the cache instead of refetching.
  const initialSnapshotAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialSnapshotAppliedRef.current && initialSnapshot) {
      initialSnapshotAppliedRef.current = true;
      setSnapshotCache(initialFacilityId, initialSnapshot);
    }
  }, [initialSnapshot, initialFacilityId, setSnapshotCache]);

  // Skip the first client-side fetch when the server already supplied fresh
  // data for the current facility. Any later facility scope change falls
  // through to the normal load path.
  const skipNextLoadRef = useRef(initialSnapshot != null);

  const load = useCallback(async () => {
    if (authLoading) return;

    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

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
  }, [selectedFacilityId, initialFacilityId, router, authLoading, appRole, getFreshSnapshot, setSnapshotCache]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56 rounded-md bg-muted" />
          <Skeleton className="h-4 w-72 rounded-md bg-muted" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24 w-full rounded-lg bg-muted" />
          <Skeleton className="h-24 w-full rounded-lg bg-muted" />
          <Skeleton className="h-24 w-full rounded-lg bg-muted" />
          <Skeleton className="h-24 w-full rounded-lg bg-muted" />
        </div>
        <Skeleton className="h-[480px] w-full rounded-xl bg-muted" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-warning/10 text-warning">
              <AlertCircle className="size-5" />
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                Triage unavailable
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {error ?? "Unable to load operational queues. Please retry."}
              </p>
              <button
                onClick={() => void load()}
                className={cn(
                  "mt-4 inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-3",
                  "text-[12px] font-medium text-foreground transition-colors",
                  "hover:bg-secondary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                Retry
              </button>
            </div>
          </div>
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
    <div className="flex flex-col gap-6">

      {/* Page header — flat, dense, no hero card. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            Command center
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <span className="text-foreground">{snapshot.headlineName}</span>
            <span className="mx-1.5 text-border">·</span>
            {scopeLabel}
          </p>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {adminConfig.roleLabel} home — clear urgent facility actions, then blocked workflows, then resident watchlist.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[11px] text-muted-foreground tabular-nums">
            <Clock className="size-3 text-muted-foreground/70" />
            <span className="text-foreground/80">{snapshot.shiftSummary}</span>
            <span className="text-border">·</span>
            <span>{snapshot.timezoneLabel}</span>
          </span>
        </div>
      </div>

      {/* Facility priorities — slim inline strip. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Facility priorities
          </p>
          <h2 className="mt-0.5 truncate text-[13px] font-medium text-foreground">
            {adminConfig.firstScreenPriority.join(" · ").replace(/_/g, " ")}
          </h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {adminConfig.primaryTaskLanes.map((lane) => (
            <span
              key={lane}
              className="inline-flex h-6 items-center rounded border border-border/60 bg-secondary/60 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {lane.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>

      {/* Urgent now — top exception row */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Urgent now</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Facility-day exceptions that need immediate review.</p>
          </div>
        </div>
      <MotionList className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Workflow convergence</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Cross-lane backlog across doctrine, incidents, admissions, referrals, discharge, and family.</p>
          </div>
        </div>
        <MotionList className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
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

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Resident assurance</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Watch load, escalation pressure, integrity review, and safety-score risk.</p>
          </div>
        </div>
        <MotionList className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

      <div className="grid gap-4 lg:grid-cols-3 items-start">

        {/* Inbox feed — flat card, dense rows. */}
        <MotionCard delay={0.2} className="col-span-1 lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" />
                  <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
                    Primary inbox
                  </h2>
                  {totalActionable > 0 && (
                    <span className="inline-flex h-5 items-center rounded border border-destructive/30 bg-destructive/10 px-1.5 text-[10px] font-medium tabular-nums text-destructive">
                      {totalActionable} actionable
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Requires administrative intervention or sign-off.
                </p>
              </div>
            </div>

            <div className="p-3 md:p-4">
              {snapshot.workflowInbox.length === 0 && triageInboxItems.length === 0 && snapshot.activity.length === 0 && openIncidents === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 p-10 text-center">
                  <CheckCircle2 className="mb-3 size-8 text-success/60" />
                  <p className="text-[14px] font-medium text-foreground">Inbox zero</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">All operational exceptions resolved.</p>
                </div>
              ) : (
                <MotionList className="flex flex-col">
                  {triageInboxItems.map((item) => (
                    <InboxRow
                      key={item.id}
                      label={item.label}
                      labelTone="warning"
                      meta="Triage strip"
                      message={item.message}
                      href={item.href}
                      ctaLabel={item.ctaLabel}
                      ctaTone="primary"
                    />
                  ))}
                  {snapshot.workflowInbox.map((item) => {
                    const isCrit = item.tone === "critical";
                    return (
                      <InboxRow
                        key={item.id}
                        label={item.label}
                        labelTone={isCrit ? "critical" : item.tone === "warning" ? "warning" : "neutral"}
                        meta="Workflow backlog"
                        message={item.message}
                        href={item.href}
                        ctaLabel={item.ctaLabel}
                        ctaTone="primary"
                      />
                    );
                  })}
                  {snapshot.activity
                    .filter((a) => a.tone === "critical" || a.tone === "warning")
                    .map((event) => {
                      const isCrit = event.tone === "critical";
                      return (
                        <InboxRow
                          key={event.id}
                          label={event.actor}
                          labelTone={isCrit ? "critical" : "neutral"}
                          meta={event.timeLabel}
                          message={event.message}
                          href={event.href}
                          ctaLabel={event.ctaLabel}
                          ctaTone={isCrit ? "destructive" : "secondary"}
                        />
                      );
                    })}
                </MotionList>
              )}
            </div>
          </div>
        </MotionCard>
        
        {/* Sidebar — watchlist + capacity */}
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
              <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
                Acuity watchlist
              </h3>
              <Link
                href="/admin/residents?acuity=watchlist"
                className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Full roster →
              </Link>
            </div>
            <div className="flex flex-col">
              {snapshot.acuityWatchlist.map((res) => (
                <Link
                  key={res.id}
                  href={`/admin/residents/${res.id}`}
                  className={cn(
                    "group flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0",
                    "transition-colors hover:bg-secondary/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
                      {res.initials}
                    </span>
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {res.name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        Room {res.room}
                      </span>
                    </div>
                  </div>
                  {res.acuity === 3 ? (
                    <span className="inline-flex h-5 items-center rounded border border-destructive/30 bg-destructive/10 px-1.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
                      Critical
                    </span>
                  ) : (
                    <span className="inline-flex h-5 items-center rounded border border-warning/30 bg-warning/10 px-1.5 text-[10px] font-medium uppercase tracking-wider text-warning">
                      Obsv
                    </span>
                  )}
                </Link>
              ))}
              {snapshot.acuityWatchlist.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-[12px] text-muted-foreground">
                    No high-acuity residents currently.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <div className="border-b border-border/60 px-4 py-3">
              <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
                Pipeline &amp; capacity
              </h3>
            </div>
            <div className="flex flex-col">
              <CapacityRow
                href="/admin/residents?status=active"
                icon={Users}
                label="Total census"
                value={
                  snapshot.licensedBeds
                    ? `${snapshot.residentCount} / ${snapshot.licensedBeds}`
                    : String(snapshot.residentCount)
                }
              />
              <CapacityRow
                href="/admin/admissions/blocked"
                icon={DoorOpen}
                label="Blocked admissions"
                value={String(workflows.admissionsBlocked)}
                valueTone={workflows.admissionsBlocked > 0 ? "warning" : "default"}
              />
              <CapacityRow
                href="/admin/admissions/move-in-ready"
                icon={CheckCircle2}
                label="Move-in ready"
                value={String(workflows.admissionsMoveInReady)}
                valueTone={workflows.admissionsMoveInReady > 0 ? "info" : "default"}
              />
              <CapacityRow
                href="/admin/admissions/onboarding"
                icon={HeartPulse}
                label="Onboarding pending"
                value={String(workflows.admissionsOnboardingPending)}
                valueTone={workflows.admissionsOnboardingPending > 0 ? "critical" : "default"}
              />
              <CapacityRow
                href={referralPrimaryHref}
                icon={ArrowRightLeft}
                label={referralPrimaryTitle}
                value={String(referralPrimaryValue)}
                valueTone="info"
              />
              <CapacityRow
                href="/admin/residents?status=away"
                icon={HeartPulse}
                label="LOA / Hospital"
                value={String(snapshot.awayResidentCount)}
                valueTone={snapshot.awayResidentCount > 0 ? "warning" : "default"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapacityRow({
  href,
  icon: Icon,
  label,
  value,
  valueTone = "default",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  valueTone?: "default" | "info" | "warning" | "critical";
}) {
  const toneClass: Record<NonNullable<typeof valueTone>, string> = {
    default: "text-foreground",
    info: "text-info",
    warning: "text-warning",
    critical: "text-destructive",
  };
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0",
        "transition-colors hover:bg-secondary/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className={cn("text-[14px] font-semibold tabular-nums tracking-tight", toneClass[valueTone])}>
        {value}
      </span>
    </Link>
  );
}

type InboxRowTone = "neutral" | "warning" | "critical";
type CtaTone = "primary" | "secondary" | "destructive";

function InboxRow({
  label,
  labelTone,
  meta,
  message,
  href,
  ctaLabel,
  ctaTone,
}: {
  label: string;
  labelTone: InboxRowTone;
  meta: string;
  message: string;
  href: string;
  ctaLabel: string;
  ctaTone: CtaTone;
}) {
  const labelClass: Record<InboxRowTone, string> = {
    neutral: "border-border/60 bg-secondary/60 text-muted-foreground",
    warning: "border-warning/30 bg-warning/10 text-warning",
    critical: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  const ctaClass: Record<CtaTone, string> = {
    primary:
      "bg-foreground text-background hover:bg-foreground/90",
    secondary:
      "border border-border bg-card text-foreground hover:bg-secondary",
    destructive:
      "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
  };
  return (
    <MotionItem className="flex flex-col gap-2 border-b border-border/60 px-3 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-medium uppercase tracking-wider",
              labelClass[labelTone],
            )}
          >
            {label}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" /> {meta}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground">{message}</p>
      </div>
      <Link
        href={href}
        className={cn(
          "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-[12px] font-medium",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ctaClass[ctaTone],
        )}
      >
        {ctaLabel}
      </Link>
    </MotionItem>
  );
}

function TriageMetricCard({
  title,
  value,
  icon: Icon,
  urgency,
  subLabel,
  href,
}: {
  title: string;
  value: number;
  icon: LucideIcon;
  urgency: "critical" | "high" | "medium" | "normal";
  subLabel: string;
  href: string;
}) {
  /* Linear/Vercel-style KPI tile: flat card, ring accent on left for urgency. */
  const ringClass: Record<typeof urgency, string> = {
    critical: "before:bg-destructive",
    high: "before:bg-warning",
    medium: "before:bg-info",
    normal: "before:bg-border",
  };
  const valueTone: Record<typeof urgency, string> = {
    critical: "text-destructive",
    high: "text-warning",
    medium: "text-info",
    normal: "text-foreground",
  };
  const iconTone: Record<typeof urgency, string> = {
    critical: "bg-destructive/10 text-destructive",
    high: "bg-warning/10 text-warning",
    medium: "bg-info/10 text-info",
    normal: "bg-secondary text-muted-foreground",
  };

  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-lg outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div
        className={cn(
          "relative flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4",
          "transition-colors duration-150 group-hover:bg-secondary/40",
          "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r-full",
          ringClass[urgency],
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">
            {title}
          </span>
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md",
              iconTone[urgency],
            )}
            aria-hidden
          >
            <Icon className="size-3.5" />
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className={cn(
              "text-[26px] font-semibold tabular-nums tracking-tight leading-none",
              valueTone[urgency],
            )}
          >
            {value}
          </span>
          <span className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {subLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
