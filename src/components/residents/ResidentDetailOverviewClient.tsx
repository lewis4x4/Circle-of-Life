"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Brain, FileText, NotebookPen, Stethoscope, User } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { BehaviorLogModal, ConditionLogModal, GeneralNoteModal } from "@/components/admin/resident-log-modals";
import {
  ResidentCodeStatusValue,
  ResidentFallRiskPresentation,
  hospiceElectionPhrase,
  polstMolstFriendly,
  resolveCodeStatusPresentation,
} from "@/components/residents/resident-clinical-overview-widgets";
import { ResidentDetailTabStrip, type ResidentDetailHrefConfig } from "@/components/residents/ResidentDetailTabStrip";
import { ResidentPresenceControl } from "@/components/residents/ResidentPresenceControl";
import { HoldDeclineReturnButton } from "@/components/residents/HoldDeclineReturnButton";
import { RecordDischargeAction } from "@/components/residents/RecordDischargeAction";
import { MonitoringOrderAction } from "@/components/rounding/MonitoringOrderAction";
import { ResidentMonitoringOrderBand } from "@/components/rounding/ResidentMonitoringOrderBand";
import { ResidentIntakeLinks } from "@/components/resident-intake";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  loadResidentOverviewDetail,
  type ADLEventContent,
  type BehaviorEventContent,
  type ConditionEventContent,
  type ResidentContactRowView,
  type ResidentOverviewDetail,
} from "@/lib/residents/resident-detail-overview-load";
import { classifyAnnualReview } from "@/lib/residents/care-plan-annual-review-window";
import { isPresenceStatus, lifecycleStatusLabel } from "@/lib/residents/presence";
import { diagnosisDisplayTitle } from "@/lib/residents/clinical-text-format";
import { acuityDisplay } from "@/lib/residents/resident-acuity-display";
import {
  ACTIVITY_FEED_FILTER_LABELS,
  activityFeedEmptyCopy,
  activityFeedFilteredEmptyCopy,
  activityFeedWindow,
  isWithinActivityWindow,
  resolveActivityFeedState,
  type ActivityFeedFilter,
  type ActivityFeedKind,
} from "@/lib/residents/resident-activity-feed";
import { recordedDiagnoses } from "@/lib/residents/resident-diagnosis-display";
import { RESIDENT_NO_UNIT_COPY as NO_UNIT_COPY } from "@/lib/residents/roster-display-copy";
import { formatResidentOverviewGenderLabel } from "@/lib/residents/resident-overview-display-copy";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export type ResidentOverviewWorkspace = "admin" | "clinical";

function residentHrefSet(id: string, workspace: ResidentOverviewWorkspace): ResidentDetailHrefConfig {
  const canonical = `/admin/residents/${id}`;
  if (workspace === "clinical") {
    return {
      rosterHref: "/clinical/residents",
      residentRootHref: canonical,
      overviewHref: `/clinical/residents/${id}`,
      assessmentsHref: `${canonical}/assessments`,
      carePlanHref: `${canonical}/care-plan`,
      medicationsHref: `${canonical}/medications`,
      vitalsHref: `${canonical}/vitals`,
      timelineHref: `${canonical}/timeline`,
      billingHref: `${canonical}/billing`,
    };
  }
  const base = `/admin/residents`;
  return {
    rosterHref: base,
    residentRootHref: canonical,
    overviewHref: canonical,
    assessmentsHref: `${canonical}/assessments`,
    carePlanHref: `${canonical}/care-plan`,
    medicationsHref: `${canonical}/medications`,
    vitalsHref: `${canonical}/vitals`,
    timelineHref: `${canonical}/timeline`,
    billingHref: `${canonical}/billing`,
  };
}

function isoDayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** "Verified Sep 1, 2026 by Jane Doe" or null when no verification is recorded. */
function verificationLabel(verb: string, iso: string | null, actor: string | null): string | null {
  const day = isoDayLabel(iso);
  if (!day) return null;
  const who = actor?.trim().length ? actor : "staff (not attributed)";
  return `${verb} ${day} by ${who}`;
}

function severityClinicalLabel(raw: string): string {
  return diagnosisDisplayTitle(raw.replace(/_/g, " "));
}

function AcuityChip({ acuityLevel }: { acuityLevel: string | null }) {
  const display = acuityDisplay(acuityLevel);
  if (display.tone === "gap") {
    return <span className="text-[13px] text-muted-foreground">{display.label}</span>;
  }
  return (
    <StatusPill tone={display.tone} className="normal-case tracking-tight">
      {display.label}
    </StatusPill>
  );
}

type TaskTone = "danger" | "warning" | "muted";

type TaskItem = { id: string; title: string; tone: TaskTone; sub: string; href: string };

/** Recorded due dates only — no placeholder tasks the record does not carry. */
export function buildTaskItems(
  detail: Pick<ResidentOverviewDetail, "carePlanAnnualDeltaDays" | "carePlanVersion" | "assessmentsUpcomingJson">,
  hrefs: Pick<ResidentDetailHrefConfig, "carePlanHref" | "assessmentsHref">,
  now: Date = new Date(),
): TaskItem[] {
  const items: TaskItem[] = [];
  const cpDelta = detail.carePlanAnnualDeltaDays;
  if (detail.carePlanVersion == null) {
    items.push({
      id: "cp-none",
      title: "No active care plan on file",
      tone: "warning",
      sub: "Open the care plan tab to start one",
      href: hrefs.carePlanHref,
    });
  } else if (cpDelta != null) {
    const cls = classifyAnnualReview(cpDelta);
    if (cls.kind === "overdue") {
      items.push({ id: "cp-over", title: "Annual care plan review", tone: "danger", sub: `${cls.days} days overdue`, href: hrefs.carePlanHref });
    } else if (cls.kind === "dueToday") {
      items.push({ id: "cp-today", title: "Annual care plan review", tone: "danger", sub: "Due today", href: hrefs.carePlanHref });
    } else if (cls.kind === "approaching") {
      items.push({ id: "cp-soon", title: "Annual care plan review", tone: "warning", sub: `${cls.days} days until due`, href: hrefs.carePlanHref });
    }
  }

  detail.assessmentsUpcomingJson.slice(0, 5).forEach((row, idx) => {
    const dueIso = row.nextDue;
    if (!dueIso) return;
    const due = new Date(`${dueIso}T12:00:00`);
    const diff = Math.round((due.getTime() - now.getTime()) / 86400000);
    let tone: TaskTone = "muted";
    let sub = `Due ${isoDayLabel(dueIso) ?? dueIso}`;
    if (diff < 0) {
      tone = "danger";
      sub = `${Math.abs(diff)} days overdue`;
    } else if (diff <= 30) {
      tone = "warning";
      sub = `Due in ${diff} days`;
    }
    items.push({
      id: `asm-${idx}`,
      title: diagnosisDisplayTitle(row.assessmentType.replace(/_/g, " ")) || row.assessmentType,
      tone,
      sub,
      href: hrefs.assessmentsHref,
    });
  });

  const order = { danger: 0, warning: 1, muted: 2 };
  items.sort((a, b) => order[a.tone] - order[b.tone]);
  return items;
}

type CompletenessItem = { id: string; label: string; href: string };

/** Items the record does not yet carry, each with where to record it. */
export function buildRecordGaps(
  detail: Pick<
    ResidentOverviewDetail,
    | "acuityLevel"
    | "codeStatusRaw"
    | "codeStatusVerifiedAt"
    | "allergyReviewedAt"
    | "carePlanVersion"
    | "unitName"
    | "primaryPhysicianName"
    | "diagnosisRawList"
  >,
  hrefs: { profileHref: string; carePlanHref: string; assessmentsHref: string },
  noUnitCopy: string,
): CompletenessItem[] {
  const gaps: CompletenessItem[] = [];
  if (acuityDisplay(detail.acuityLevel).level == null) {
    gaps.push({ id: "acuity", label: "Acuity assessment", href: hrefs.assessmentsHref });
  }
  const code = resolveCodeStatusPresentation(detail.codeStatusRaw);
  if (code.label === "Not on file") {
    gaps.push({ id: "code", label: "Code status", href: hrefs.profileHref });
  } else if (!detail.codeStatusVerifiedAt) {
    gaps.push({ id: "code-verify", label: "Code status verification", href: hrefs.profileHref });
  }
  if (!detail.allergyReviewedAt) gaps.push({ id: "allergy", label: "Allergy review", href: hrefs.profileHref });
  if (detail.diagnosisRawList.length === 0) gaps.push({ id: "dx", label: "Diagnoses", href: hrefs.profileHref });
  if (detail.carePlanVersion == null) gaps.push({ id: "plan", label: "Active care plan", href: hrefs.carePlanHref });
  if (detail.unitName === noUnitCopy) gaps.push({ id: "unit", label: "Unit assignment", href: hrefs.profileHref });
  if (!detail.primaryPhysicianName) gaps.push({ id: "pcp", label: "Primary care physician", href: hrefs.profileHref });
  return gaps;
}

type FeedItem =
  | { kind: "condition"; id: string; atIso: string; label: string; content: ConditionEventContent }
  | { kind: "behavior"; id: string; atIso: string; label: string; content: BehaviorEventContent }
  | { kind: "adl"; id: string; atIso: string; label: string; content: ADLEventContent }
  | { kind: "note"; id: string; atIso: string; label: string; content: { snippet: string; shift: string; loggedByLabel: string } };

function feedItemTime(item: FeedItem): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(item.atIso) ? `${item.atIso}T12:00:00` : item.atIso;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function buildFeedItems(detail: ResidentOverviewDetail): FeedItem[] {
  const items: FeedItem[] = [
    ...detail.recentConditionChanges.map((c) => ({
      kind: "condition" as const,
      id: c.id,
      atIso: c.reportedAtIso,
      label: c.reportedLabel,
      content: c,
    })),
    ...detail.recentBehavior.map((b) => ({
      kind: "behavior" as const,
      id: b.id,
      atIso: b.occurredAtIso,
      label: b.occurredLabel,
      content: b,
    })),
    ...detail.recentAdl
      .filter((a) => a.summary.includes("refused"))
      .map((a) => ({ kind: "adl" as const, id: a.id, atIso: a.logTimeIso, label: a.logTimeLabel, content: a })),
    ...detail.recentDailyNotes
      .filter((n) => n.hasNote)
      .map((n) => ({
        kind: "note" as const,
        id: n.id,
        atIso: n.logDate,
        label: `${isoDayLabel(n.logDate) ?? n.logDate} · ${n.shift.replace(/_/g, " ")} shift`,
        content: { snippet: n.snippet, shift: n.shift, loggedByLabel: n.loggedByLabel },
      })),
  ];
  return items.sort((a, b) => feedItemTime(b) - feedItemTime(a));
}

export type ResidentDetailOverviewClientProps = {
  workspace: ResidentOverviewWorkspace;
  initialDetail?: ResidentOverviewDetail | null;
  initialError?: string | null;
  initialFacilityId?: string | null;
};


export function ResidentDetailOverviewClient({
  workspace,
  initialDetail = null,
  initialError = null,
  initialFacilityId,
}: ResidentDetailOverviewClientProps) {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { selectedFacilityId } = useFacilityStore();
  const bootstrapped = initialFacilityId !== undefined;

  const skipNextLoadRef = useRef(bootstrapped && initialError == null);

  const [loading, setLoading] = useState(!bootstrapped);
  const [error, setError] = useState<string | null>(initialError);
  const [notFound, setNotFound] = useState(bootstrapped && !initialDetail && !initialError);
  const [detail, setDetail] = useState<ResidentOverviewDetail | null>(initialDetail);
  const [behaviorModalOpen, setBehaviorModalOpen] = useState(false);
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [generalNoteModalOpen, setGeneralNoteModalOpen] = useState(false);
  const [contactModal, setContactModal] = useState<ResidentContactRowView | null>(null);
  const [dobVisible, setDobVisible] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFeedFilter>("all");

  const hrefs = useMemo(() => residentHrefSet(residentId, workspace), [residentId, workspace]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    // A silent refresh (after a quick-entry save) keeps the current page and
    // any open dialog mounted; a full load blanks the page into its loading state.
    if (!options?.silent) {
      setLoading(true);
      setDetail(null);
    }
    setError(null);
    setNotFound(false);

    const uuidOk = UUID_STRING_RE.test(residentId);
    if (!residentId || !uuidOk) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const row = await loadResidentOverviewDetail(residentId, selectedFacilityId);
      if (!row) {
        setNotFound(true);
      } else {
        setDetail(row);
      }
    } catch (err) {
      setError(
        formatLiveDataLoadError(err, "Live resident profile is unavailable right now."),
      );
    } finally {
      setLoading(false);
    }
  }, [residentId, selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAfterLog = useCallback(() => {
    void load({ silent: true });
  }, [load]);

  // The Monitoring Order band reads its own row, so entering an order has to
  // tell it to look again; reloading the overview alone would leave the band
  // showing the state from before the order.
  const [monitoringOrderToken, setMonitoringOrderToken] = useState(0);
  const onMonitoringOrderChanged = useCallback(() => {
    setMonitoringOrderToken((token) => token + 1);
    void load({ silent: true });
  }, [load]);

  if (loading) {
    return (
      <div className="fade-in animate-in space-y-6 duration-[var(--motion-duration)]">
        <Link
          prefetch={false}
          href={hrefs.rosterHref}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          ← Resident roster
        </Link>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="fade-in animate-in space-y-6 duration-[var(--motion-duration)]">
        <Link prefetch={false} href={hrefs.rosterHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}>
          ← Resident roster
        </Link>
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-xl">Resident not found</CardTitle>
            <CardDescription>This profile may be outside your facility filter, discharged, or the link is invalid.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="fade-in animate-in space-y-6 duration-[var(--motion-duration)]">
        <Link prefetch={false} href={hrefs.rosterHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}>
          ← Resident roster
        </Link>
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
      </div>
    );
  }

  const feedWindow = activityFeedWindow();
  const allFeedItems = buildFeedItems(detail);
  const inWindowItems = allFeedItems.filter((item) => isWithinActivityWindow(item.atIso, feedWindow));
  const visibleItems =
    activityFilter === "all" ? inWindowItems : inWindowItems.filter((item) => item.kind === activityFilter);
  const feedState = resolveActivityFeedState({
    status: "ready",
    inWindowCount: inWindowItems.length,
    visibleCount: visibleItems.length,
  });
  const kindsRecorded = new Set<ActivityFeedKind>(inWindowItems.map((item) => item.kind));

  const subtitleLine = [
    detail.ageYears != null ? `Age ${detail.ageYears}` : "Age not recorded",
    formatResidentOverviewGenderLabel(detail.gender),
    `Room ${detail.roomLabel}`,
    detail.unitName || NO_UNIT_COPY,
    `Admitted ${detail.admissionLabel}`,
  ].join(" · ");

  const contactPrimaryCandidates = [...detail.contacts].filter((c) => c.isEmergencyContact).sort((a, b) => a.sortOrder - b.sortOrder);
  const primaryContactRow = contactPrimaryCandidates[0] ?? null;
  const secondaryContactRow = contactPrimaryCandidates[1] ?? null;
  const poaRows = [...detail.contacts].filter((c) => c.isHealthcareProxy || c.isPowerOfAttorney);
  const poaPreferred = [...poaRows].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

  const carePlanAnnual =
    detail.carePlanAnnualDeltaDays != null ? classifyAnnualReview(detail.carePlanAnnualDeltaDays) : null;

  const profileEditHref = `/admin/v2/residents/${residentId}`;
  const taskItems = buildTaskItems(detail, hrefs);
  const recordGaps = buildRecordGaps(
    detail,
    { profileHref: profileEditHref, carePlanHref: hrefs.carePlanHref, assessmentsHref: hrefs.assessmentsHref },
    NO_UNIT_COPY,
  );

  const polstMolst = polstMolstFriendly(detail.polstMolstRawStatus);
  const dietLower = detail.dietOrder?.toLowerCase() ?? "";
  const tubeHint =
    /tube|ng\s|gtube|peg|feeding\s+tube/i.test(dietLower) ? "Entered on diet orders" : "Not on file";
  const dnhPhrase = detail.advanceDirectiveOnFile ? "Captured on file" : "Not on file";

  const codeStatus = resolveCodeStatusPresentation(detail.codeStatusRaw);
  const codeVerified = verificationLabel("Verified", detail.codeStatusVerifiedAt, detail.codeStatusVerifiedByName);
  const allergyReviewed = verificationLabel("Reviewed", detail.allergyReviewedAt, detail.allergyReviewedByName);
  const diagnosesReviewed = verificationLabel("Updated", detail.diagnosesReviewedAt, detail.diagnosesReviewedByName);
  const diagnoses = recordedDiagnoses(detail.primaryDiagnosisRaw, detail.diagnosisListRaw);
  const acuity = acuityDisplay(detail.acuityLevel);

  const logActions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setBehaviorModalOpen(true)}
        className="h-auto min-h-[44px] min-w-0 px-2 py-2 text-[12px] font-medium sm:px-4 sm:text-[13px] md:h-10 md:min-h-0 md:py-0"
      >
        <Brain className="mr-1.5 size-4" aria-hidden /> Log behavior
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => setConditionModalOpen(true)}
        className="h-auto min-h-[44px] min-w-0 px-2 py-2 text-[12px] font-medium sm:px-4 sm:text-[13px] md:h-10 md:min-h-0 md:py-0"
      >
        <Stethoscope className="mr-1.5 size-4" aria-hidden /> Log condition
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => setGeneralNoteModalOpen(true)}
        className="h-auto min-h-[44px] min-w-0 px-2 py-2 text-[12px] font-medium sm:px-4 sm:text-[13px] md:h-10 md:min-h-0 md:py-0"
      >
        <FileText className="mr-1.5 size-4" aria-hidden /> General note
      </Button>
    </>
  );

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-4 pt-2">
      <Dialog open={contactModal != null} onOpenChange={(o) => !o && setContactModal(null)}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{contactModal?.name}</DialogTitle>
          </DialogHeader>
          {contactModal ? (
            <div className="space-y-3 text-[13px] text-foreground">
              <p className="text-muted-foreground">
                {contactModal.relationship ?? "Relationship not recorded"} · {contactModal.phone ?? "Phone not recorded"}
              </p>
              <p className="text-muted-foreground">
                Last contact {isoDayLabel(contactModal.updatedAt) ?? "not recorded"}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <RecordDetailHeader
        title={detail.fullName}
        subtitle={subtitleLine}
        backLink={{ label: "Resident roster", href: hrefs.rosterHref }}
        statusChips={
          <>
            {isPresenceStatus(detail.rawStatus) ? (
              <>
                <ResidentPresenceControl residentId={detail.id} status={detail.status} onChanged={onAfterLog} />
                <HoldDeclineReturnButton residentId={detail.id} status={detail.status} onDone={onAfterLog} />
                {/* Ending a residency is a lifecycle change, so it is its own
                    confirmed action rather than an option in the presence
                    picker. It is also the event that frees the bed (COL-418). */}
                <RecordDischargeAction residentId={detail.id} residentName={detail.fullName} onDone={onAfterLog} />
                {/* Monitoring Order lives here rather than inside Smart
                    Rounding: the person holding the discharge paperwork opens
                    the resident, not a module. */}
                <MonitoringOrderAction
                  residentId={detail.id}
                  residentName={detail.fullName}
                  facilityId={detail.facilityId}
                  onDone={onMonitoringOrderChanged}
                />
              </>
            ) : (
              <StatusPill tone="muted">{lifecycleStatusLabel(detail.rawStatus)}</StatusPill>
            )}
            <AcuityChip acuityLevel={detail.acuityLevel} />
            <DobReveal dobLabel={detail.dobLabel} visible={dobVisible} onToggle={() => setDobVisible((v) => !v)} />
          </>
        }
        actions={<div className="hidden items-center gap-2 md:flex">{logActions}</div>}
      />

      {/* Narrow screens: the same three actions as a full-width row under the identity block. */}
      <div className="-mt-3 grid grid-cols-3 gap-2 md:hidden" aria-label="Documentation actions">
        {logActions}
      </div>

      <ResidentMonitoringOrderBand residentId={detail.id} reloadToken={monitoringOrderToken} />

      <div className="w-full shrink-0">
        <ResidentDetailTabStrip hrefs={hrefs} active="overview" />
      </div>

      <section
        aria-label="Care summary"
        className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] ring-1 ring-border/60"
      >
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCell label="Code status">
            <ResidentCodeStatusValue raw={detail.codeStatusRaw} />
            {codeStatus.label !== "Not on file" ? (
              codeVerified ? (
                <p className="text-[11px] leading-snug text-muted-foreground">{codeVerified}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                    Not verified
                  </span>
                  <QuietLink href={profileEditHref} label="Verify" />
                </div>
              )
            ) : (
              <QuietLink href={profileEditHref} label="Record code status" />
            )}
          </SummaryCell>

          <SummaryCell label="Allergies">
            {detail.allergiesTokens.length > 0 ? (
              <StatusPill tone="danger" className="whitespace-normal text-left normal-case tracking-tight">
                {detail.allergiesTokens.map((t) => diagnosisDisplayTitle(t)).join("; ")}
              </StatusPill>
            ) : detail.allergyReviewedAt ? (
              <p className="text-[14px] font-medium leading-snug text-foreground">No known drug allergies</p>
            ) : (
              <p className="text-[14px] font-medium leading-snug text-muted-foreground">Not reviewed</p>
            )}
            {allergyReviewed ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{allergyReviewed}</p>
            ) : (
              <QuietLink href={profileEditHref} label="Record allergy review" />
            )}
          </SummaryCell>

          <SummaryCell label="Acuity">
            {acuity.level == null ? (
              <>
                <p className="text-[14px] font-medium leading-snug text-muted-foreground">{acuity.label}</p>
                <QuietLink href={hrefs.assessmentsHref} label="Open assessments" />
              </>
            ) : (
              <AcuityChip acuityLevel={detail.acuityLevel} />
            )}
          </SummaryCell>

          <SummaryCell label="Fall risk">
            <ResidentFallRiskPresentation raw={detail.fallRiskRaw} />
          </SummaryCell>

          <SummaryCell label="Diet order">
            <p className={cn("text-[14px] font-medium leading-snug", !detail.dietOrder && "text-muted-foreground")}>
              {diagnosisDisplayTitle(detail.dietOrder ?? "") || "Not recorded"}
            </p>
          </SummaryCell>

          <SummaryCell label="Care plan">
            {detail.carePlanVersion != null ? (
              <>
                <p className="text-[14px] font-medium leading-snug text-foreground">Active v{detail.carePlanVersion}</p>
                {carePlanAnnual?.kind === "overdue" ? (
                  <StatusPill tone="danger">Review overdue by {carePlanAnnual.days} days</StatusPill>
                ) : carePlanAnnual?.kind === "dueToday" ? (
                  <StatusPill tone="danger">Review due today</StatusPill>
                ) : carePlanAnnual?.kind === "approaching" ? (
                  <StatusPill tone="warning">Review due in {carePlanAnnual.days} days</StatusPill>
                ) : detail.carePlanEffectiveDate ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Effective {isoDayLabel(detail.carePlanEffectiveDate)}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[14px] font-medium leading-snug text-muted-foreground">No active plan</p>
            )}
            <QuietLink href={hrefs.carePlanHref} label="Open care plan" />
          </SummaryCell>
        </div>
      </section>

      <section
        aria-label="Clinical record"
        className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] ring-1 ring-border/60"
      >
        <Disclosure title="Advance directives">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DirectiveRow label="Code status" value={<ResidentCodeStatusValue raw={detail.codeStatusRaw} />}>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {codeVerified ?? "Verification not recorded"}
              </p>
              {!codeVerified ? <QuietLink href={profileEditHref} label="Verify in profile editor" /> : null}
            </DirectiveRow>
            <DirectiveRow label="DNH (Do Not Hospitalize)" value={dnhPhrase} muted={!detail.advanceDirectiveOnFile}>
              {!detail.advanceDirectiveOnFile ? <QuietLink href={profileEditHref} label="+ Add DNH notation" /> : null}
            </DirectiveRow>
            <DirectiveRow label="POLST / MOLST" value={polstMolst} muted={polstMolst.startsWith("Not")}>
              {polstMolst.startsWith("Not") ? <QuietLink href={profileEditHref} label="+ Add directive document" /> : null}
            </DirectiveRow>
            <DirectiveRow label="Feeding tube" value={tubeHint} muted={tubeHint.includes("Not")}>
              {tubeHint.includes("Not") ? <QuietLink href={profileEditHref} label="+ Add tube details" /> : null}
            </DirectiveRow>
            <DirectiveRow
              label="Hospice election"
              value={
                detail.hospiceStatus === "active" ? (
                  <StatusPill tone="danger" className="normal-case tracking-tight">
                    {hospiceElectionPhrase(detail.hospiceStatus)}
                  </StatusPill>
                ) : (
                  <span className="font-medium">{hospiceElectionPhrase(detail.hospiceStatus ?? null)}</span>
                )
              }
              muted={detail.hospiceStatus !== "active"}
            >
              {!detail.hospiceStatus || detail.hospiceStatus === "none" ? (
                <QuietLink href={profileEditHref} label="+ Add hospice intake" />
              ) : null}
            </DirectiveRow>
            <DirectiveRow label="Advance directive type" value={detail.advanceDirectiveType ?? "Not recorded"} muted={!detail.advanceDirectiveType} />
          </div>
        </Disclosure>

        <Disclosure title={`Diagnoses${diagnoses.conditions.length > 0 ? ` (${diagnoses.conditions.length} recorded)` : ""}`}>
          {diagnoses.conditions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No diagnoses recorded</p>
          ) : (
            <div className="space-y-3">
              {diagnoses.primary ? (
                <p className="text-[13px]">
                  <span className="text-muted-foreground">Primary diagnosis: </span>
                  <span className="font-medium text-foreground">{diagnoses.primary}</span>
                </p>
              ) : null}
              <ul className="flex flex-wrap gap-1.5" aria-label="Recorded diagnoses">
                {diagnoses.conditions.map((phrase) => (
                  <li key={phrase} className="rounded-sm bg-muted/50 px-2 py-0.5 text-[12px] text-foreground">
                    {phrase}
                  </li>
                ))}
              </ul>
              {diagnoses.combinedPrimaryAsEntered ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The primary diagnosis field holds these conditions as one combined entry, as entered:{" "}
                  <span className="text-foreground">{diagnoses.combinedPrimaryAsEntered}</span>
                </p>
              ) : null}
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">{diagnosesReviewed ?? "Last update not recorded"}</p>
        </Disclosure>

        <Disclosure title="Allergies, orders and coverage">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DirectiveRow
              label="Allergies"
              value={
                detail.allergiesTokens.length === 0
                  ? detail.allergyReviewedAt
                    ? "No known drug allergies documented"
                    : "Not reviewed"
                  : detail.allergiesTokens.map((t) => diagnosisDisplayTitle(t)).join("; ")
              }
              muted={detail.allergiesTokens.length === 0}
            >
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {allergyReviewed ?? "Review not recorded"}
              </p>
            </DirectiveRow>
            <DirectiveRow
              label="Diet order"
              value={diagnosisDisplayTitle(detail.dietOrder ?? "") || "Not recorded"}
              muted={!detail.dietOrder}
            />
            <DirectiveRow label="Fall risk" value={<ResidentFallRiskPresentation raw={detail.fallRiskRaw} />} />
            <DirectiveRow label="Primary payer" value={detail.primaryPayer ?? "Not recorded"} muted={!detail.primaryPayer} />
          </div>
        </Disclosure>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8" id="activity-timeline">
          <RecordDetailSection
            title="Recent activity"
            description={`Last 30 days · ${feedWindow.label}`}
            action={
              <div className="flex items-center gap-1.5">
                <label htmlFor="resident-activity-filter" className="text-[12px] text-muted-foreground">
                  Show
                </label>
                <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as ActivityFeedFilter)}>
                  <SelectTrigger
                    id="resident-activity-filter"
                    className="h-8 w-[min(100vw-2rem,170px)] rounded-md border border-input bg-card px-3 text-[12px] shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTIVITY_FEED_FILTER_LABELS) as ActivityFeedFilter[]).map((key) => (
                      <SelectItem key={key} value={key} className="text-[12px]">
                        {ACTIVITY_FEED_FILTER_LABELS[key]}
                        {key !== "all" && kindsRecorded.has(key) ? "" : key !== "all" ? " (none)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          >
            {feedState === "success-empty" ? (
              <div className="flex flex-col items-start gap-3 py-2" role="status">
                <p className="text-[13px] font-medium text-foreground">{activityFeedEmptyCopy(feedWindow)}</p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Behavior logs, condition changes, ADL refusals and general notes recorded for {detail.fullName} appear
                  here. Nothing recorded in this period does not confirm an uneventful period.
                </p>
                <div className="flex flex-wrap items-center gap-2">{logActions}</div>
              </div>
            ) : feedState === "filtered-empty" ? (
              <div className="flex flex-col items-start gap-3 py-2" role="status">
                <p className="text-[13px] font-medium text-foreground">
                  {activityFeedFilteredEmptyCopy(activityFilter, feedWindow)}
                </p>
                <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setActivityFilter("all")}>
                  Show all entries ({inWindowItems.length})
                </Button>
              </div>
            ) : (
              <div className="scrollbar-hide -mx-[14px] max-h-[640px] min-h-0 space-y-4 overflow-y-auto px-[14px]">
                {visibleItems.map((item, idx) => renderFeedItem(item, idx))}
              </div>
            )}
          </RecordDetailSection>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <RecordDetailSection title="Tasks and due dates">
            {taskItems.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                No due dates recorded. Care plan reviews and assessment due dates appear here once recorded.
              </p>
            ) : (
              <ul className="space-y-2 text-[12px]">
                {taskItems.slice(0, 6).map((task) => (
                  <li key={task.id} className="flex gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        task.tone === "danger" ? "bg-destructive" : task.tone === "warning" ? "bg-warning" : "bg-muted-foreground/60",
                      )}
                    />
                    <div className="min-w-0">
                      <Link
                        prefetch={false}
                        href={task.href}
                        className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {task.title}
                      </Link>
                      <p className="text-muted-foreground">{task.sub}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {taskItems.length > 6 ? (
              <Link prefetch={false} href={hrefs.assessmentsHref} className="mt-3 inline-block text-[12px] font-medium underline-offset-4 hover:underline">
                View all ({taskItems.length})
              </Link>
            ) : null}
          </RecordDetailSection>

          <RecordDetailSection title="Care contacts">
            <ContactBlock
              tier="Primary contact"
              row={primaryContactRow}
              onOpen={() => primaryContactRow && setContactModal(primaryContactRow)}
              emptyHref={profileEditHref}
              emptyCopy="+ Add primary contact"
            />
            <ContactBlock
              tier="Secondary contact"
              row={secondaryContactRow}
              onOpen={() => secondaryContactRow && setContactModal(secondaryContactRow)}
              emptyHref={profileEditHref}
              emptyCopy="+ Add secondary contact"
            />
            <ContactBlock
              tier="POA / healthcare proxy"
              row={poaPreferred}
              onOpen={() => poaPreferred && setContactModal(poaPreferred)}
              emptyHref={profileEditHref}
              emptyCopy="+ Add POA"
            />
            <div>
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Primary care physician</p>
              {detail.primaryPhysicianName ? (
                <p className="text-[13px] font-medium leading-relaxed">
                  {detail.primaryPhysicianName}
                  <br />
                  <span className="text-[11px] text-muted-foreground">{detail.primaryPhysicianPhone ?? "Phone not recorded"}</span>
                </p>
              ) : (
                <QuietLink href={profileEditHref} label="+ Add primary care physician" />
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Specialist consults on file: <span className="font-semibold text-foreground">{detail.specialistConsultActiveCount}</span>
              </p>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Record completeness">
            {recordGaps.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Every tracked item on this record is recorded.</p>
            ) : (
              <>
                <p className="text-[12px] text-muted-foreground">Not yet recorded for this resident:</p>
                <ul className="space-y-1 text-[12px]">
                  {recordGaps.map((gap) => (
                    <li key={gap.id} className="flex items-center gap-2">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                      <Link
                        prefetch={false}
                        href={gap.href}
                        className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {gap.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="border-t border-border pt-3">
              <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <NotebookPen className="size-3.5" aria-hidden />
                Admission documents
              </p>
              <ResidentIntakeLinks residentId={detail.id} compact />
            </div>
          </RecordDetailSection>
        </div>
      </div>

      <BehaviorLogModal
        open={behaviorModalOpen}
        onOpenChange={setBehaviorModalOpen}
        residentId={residentId}
        residentName={detail.fullName}
        onSuccess={onAfterLog}
      />
      <ConditionLogModal
        open={conditionModalOpen}
        onOpenChange={setConditionModalOpen}
        residentId={residentId}
        residentName={detail.fullName}
        onSuccess={onAfterLog}
      />
      <GeneralNoteModal
        open={generalNoteModalOpen}
        onOpenChange={setGeneralNoteModalOpen}
        residentId={residentId}
        residentName={detail.fullName}
        onSuccess={onAfterLog}
      />
    </div>
  );
}

function DobReveal({ dobLabel, visible, onToggle }: { dobLabel: string; visible: boolean; onToggle: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      {visible ? (
        <span id="resident-dob" className="tabular-nums text-foreground">
          DOB {dobLabel}
        </span>
      ) : null}
      <button
        type="button"
        aria-expanded={visible}
        aria-controls="resident-dob"
        onClick={onToggle}
        className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? "Hide date of birth" : "Show date of birth"}
      </button>
    </span>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 bg-card px-4 py-3">
      <p className="text-[12px] font-medium leading-snug text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span aria-hidden className="inline-block text-muted-foreground transition-transform group-open:rotate-90">
          ›
        </span>
        {title}
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

function DirectiveRow(props: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  const { label, value, muted, children } = props;
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className={cn("text-[13px] font-medium", muted && "text-muted-foreground")}>{value}</div>
      {children}
    </div>
  );
}

function QuietLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      prefetch={false}
      href={href}
      className="mt-0.5 inline-flex rounded-sm text-[11px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </Link>
  );
}

function ContactBlock(props: {
  tier: string;
  row: ResidentContactRowView | null;
  onOpen: () => void;
  emptyHref?: string;
  emptyCopy?: string;
}) {
  const { tier, row, onOpen, emptyHref, emptyCopy } = props;
  return (
    <div className="mb-3 border-b border-border pb-3">
      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{tier}</p>
      {row ? (
        <button
          type="button"
          onClick={onOpen}
          className="rounded-sm text-left text-[13px] font-medium leading-relaxed underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.name} <span className="text-muted-foreground">({row.relationship ?? "relationship not recorded"})</span>
          <br />
          <span className="text-[11px] text-muted-foreground">
            {row.phone ?? "Phone not recorded"} · Last contact {isoDayLabel(row.updatedAt) ?? "not recorded"}
          </span>
        </button>
      ) : emptyHref ? (
        <QuietLink href={emptyHref} label={emptyCopy ?? "+ Add"} />
      ) : (
        <p className="text-[13px] text-muted-foreground">Not on file</p>
      )}
    </div>
  );
}

function renderFeedItem(item: FeedItem, idx: number) {
  if (item.kind === "condition") {
    const c = item.content;
    return (
      <div key={`cond-${c.id}-${idx}`} className="flex gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Stethoscope className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-[8px] border border-destructive/20 bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {c.typeLabel}{" "}
              <span className="ml-1 text-[11px] font-semibold normal-case text-destructive">
                ({severityClinicalLabel(c.severity)})
              </span>
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">{c.description}</p>
          <p className="text-[11px] text-muted-foreground">
            Logged by {c.loggedByLabel} {c.nurseNotified ? " · MD notified" : null}
          </p>
        </div>
      </div>
    );
  }
  if (item.kind === "behavior") {
    const b = item.content;
    return (
      <div key={`beh-${b.id}-${idx}`} className="flex gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
          <Brain className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-[8px] border border-warning/20 bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">{b.typeLabel}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">{b.behaviorText}</p>
          <p className="text-[11px] text-muted-foreground">
            Logged by {b.loggedByLabel}{" "}
            {b.injuryOccurred ? (
              <>
                · <span className="font-semibold text-warning">injury documented</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    );
  }
  if (item.kind === "note") {
    const n = item.content;
    return (
      <div key={`note-${item.id}-${idx}`} className="flex gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-[8px] border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">General note</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">{n.snippet}</p>
          <p className="text-[11px] text-muted-foreground">Logged by {n.loggedByLabel}</p>
        </div>
      </div>
    );
  }
  const a = item.content;
  return (
    <div key={`adl-${a.id}-${idx}`} className="flex gap-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <User className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 rounded-[8px] border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <span className="text-[13px] font-semibold text-foreground">{a.summary}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Logged by {a.loggedByLabel}</p>
      </div>
    </div>
  );
}

export default ResidentDetailOverviewClient;
