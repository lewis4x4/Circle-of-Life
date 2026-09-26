"use client";

import { formatDisplayDate } from "@/lib/format/datetime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Brain, DoorOpen, FileText, NotebookPen, ShieldCheck, Stethoscope, User } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { BehaviorLogModal, ConditionLogModal, GeneralNoteModal } from "@/components/admin/resident-log-modals";
import {
  ResidentCodeStatusValue,
  ResidentFallRiskPresentation,
  hasFallRiskAssessment,
  hospiceElectionPhrase,
  polstMolstFriendly,
  resolveCodeStatusPresentation,
} from "@/components/residents/resident-clinical-overview-widgets";
import { ResidentDetailTabStrip, type ResidentDetailHrefConfig } from "@/components/residents/ResidentDetailTabStrip";
import { ResidentPresenceControl } from "@/components/residents/ResidentPresenceControl";
import {
  ResidentDocumentationActions,
  ResidentLifecycleMenu,
} from "@/components/residents/ResidentHeaderActions";
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
  type SafetyCheckContent,
} from "@/lib/residents/resident-detail-overview-load";
import { classifyAnnualReview } from "@/lib/residents/care-plan-annual-review-window";
import { isPresenceStatus, lifecycleStatusLabel } from "@/lib/residents/presence";
import { diagnosisDisplayTitle } from "@/lib/residents/clinical-text-format";
import { acuityDisplay } from "@/lib/residents/resident-acuity-display";
import {
  ACTIVITY_FEED_FILTER_LABELS,
  ACTIVITY_FEED_PERIOD_OPTIONS,
  ACTIVITY_FEED_WINDOW_DAYS,
  activityFeedEmptyCopy,
  activityFeedFilteredEmptyCopy,
  activityFeedPeriodLabel,
  activityFeedTruncatedCopy,
  activityFeedWindow,
  isActivityFeedPeriod,
  isWithinActivityWindow,
  resolveActivityFeedState,
  type ActivityFeedFilter,
  type ActivityFeedKind,
  type ActivityFeedPeriodDays,
} from "@/lib/residents/resident-activity-feed";
import { presenceHistoryLines, presenceSinceSummary } from "@/lib/residents/resident-presence-history";
import { dnhLabel, feedingTubeLabel, type ResidentRecordField } from "@/lib/residents/resident-record-edit";
import { ResidentRecordFactDialog } from "@/components/residents/ResidentRecordFactDialog";
import { ResidentRecordHistory } from "@/components/residents/ResidentRecordHistory";
import { ChangeBedAction } from "@/components/residents/ChangeBedAction";
import { residentIntakeCreateHref } from "@/components/resident-intake/ResidentIntakeLinks";
import {
  form1823TaskItems,
  incidentFollowupTaskItems,
  sortTaskItems,
  type TaskItem,
} from "@/lib/residents/resident-task-clocks";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { useResidentBenefitsTasks } from "@/components/residents/useResidentBenefitsTasks";
import { recordedDiagnoses } from "@/lib/residents/resident-diagnosis-display";
import {
  RESPONSIBLE_PARTY_CONTACT_ID,
  RESPONSIBLE_PARTY_CONTACT_NOTE,
} from "@/lib/residents/resident-responsible-party";
import { RESIDENT_NO_UNIT_COPY as NO_UNIT_COPY } from "@/lib/residents/roster-display-copy";
import {
  formatResidentOverviewGenderLabel,
  formatResidentOverviewSpecialistCount,
} from "@/lib/residents/resident-overview-display-copy";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { enumLabel } from "@/lib/display/enum-label";
import { useLatestLoad } from "@/hooks/useLatestLoad";

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
      documentsHref: `${canonical}/documents`,
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
    documentsHref: `${canonical}/documents`,
    billingHref: `${canonical}/billing`,
  };
}

function isoDayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const label = formatDisplayDate(iso, { fallback: "" });
  return label || null;
}

/** "Verified Sep 1, 2026 by Jane Doe" or null when no verification is recorded. */
function verificationLabel(verb: string, iso: string | null, actor: string | null): string | null {
  const day = isoDayLabel(iso);
  if (!day) return null;
  const who = actor?.trim().length ? actor : "staff (not attributed)";
  return `${verb} ${day} by ${who}`;
}

function severityClinicalLabel(raw: string): string {
  return diagnosisDisplayTitle(enumLabel(raw));
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

/**
 * Recorded due dates only — no placeholder tasks the record does not carry.
 * COL-599 widened this from two clocks (care-plan review, assessments) to the
 * Form 1823 and open incident follow-ups the loader reads; benefits cases come
 * from the benefits API and are passed in as `extra`.
 */
export function buildTaskItems(
  detail: Pick<ResidentOverviewDetail, "carePlanAnnualDeltaDays" | "carePlanVersion" | "assessmentsUpcomingJson"> &
    Partial<Pick<ResidentOverviewDetail, "form1823" | "openIncidentFollowups">>,
  hrefs: Pick<ResidentDetailHrefConfig, "carePlanHref" | "assessmentsHref">,
  now: Date = new Date(),
  extra: TaskItem[] = [],
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
    let tone: TaskItem["tone"] = "muted";
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
      title: diagnosisDisplayTitle(enumLabel(row.assessmentType)) || row.assessmentType,
      tone,
      sub,
      href: hrefs.assessmentsHref,
    });
  });

  items.push(...form1823TaskItems(detail.form1823, todayFacilityDateIso(now), hrefs.carePlanHref));
  items.push(...incidentFollowupTaskItems(detail.openIncidentFollowups ?? [], now));
  items.push(...extra);

  return sortTaskItems(items);
}

/**
 * Where a gap is closed. COL-597: every gap used to be an `href` to
 * the v2 resident route — a re-export of this very page. A gap now either
 * opens the in-place editor for its field, opens Change bed, or links to a
 * different page that actually records it.
 */
export type GapAction =
  | { kind: "editor"; field: ResidentRecordField }
  | { kind: "bed" }
  | { kind: "href"; href: string };

type CompletenessItem = { id: string; label: string; action: GapAction };

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
  hrefs: { carePlanHref: string; assessmentsHref: string },
  noUnitCopy: string,
): CompletenessItem[] {
  const gaps: CompletenessItem[] = [];
  const editor = (field: ResidentRecordField): GapAction => ({ kind: "editor", field });
  if (acuityDisplay(detail.acuityLevel).level == null) {
    gaps.push({ id: "acuity", label: "Acuity assessment", action: { kind: "href", href: hrefs.assessmentsHref } });
  }
  const code = resolveCodeStatusPresentation(detail.codeStatusRaw);
  if (code.label === "Not on file") {
    gaps.push({ id: "code", label: "Code status", action: editor("code_status") });
  } else if (!detail.codeStatusVerifiedAt) {
    gaps.push({ id: "code-verify", label: "Code status verification", action: editor("code_status") });
  }
  if (!detail.allergyReviewedAt) gaps.push({ id: "allergy", label: "Allergy review", action: editor("allergy_list") });
  if (detail.diagnosisRawList.length === 0) gaps.push({ id: "dx", label: "Diagnoses", action: editor("diagnoses") });
  if (detail.carePlanVersion == null) {
    gaps.push({ id: "plan", label: "Active care plan", action: { kind: "href", href: hrefs.carePlanHref } });
  }
  // The unit is the bed's room's unit; the bed-assignment contract (migration 444) is its only writer.
  if (detail.unitName === noUnitCopy) gaps.push({ id: "unit", label: "Unit assignment", action: { kind: "bed" } });
  if (!detail.primaryPhysicianName) gaps.push({ id: "pcp", label: "Primary care physician", action: editor("primary_physician") });
  return gaps;
}

type FeedItem =
  | { kind: "condition"; id: string; atIso: string; label: string; content: ConditionEventContent }
  | { kind: "behavior"; id: string; atIso: string; label: string; content: BehaviorEventContent }
  | { kind: "adl"; id: string; atIso: string; label: string; content: ADLEventContent }
  | { kind: "note"; id: string; atIso: string; label: string; content: { snippet: string; shift: string; loggedByLabel: string } }
  | { kind: "check"; id: string; atIso: string; label: string; content: SafetyCheckContent }
  | { kind: "visit"; id: string; atIso: string; label: string; content: ResidentOverviewDetail["recentVisits"][number] };

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
        label: `${isoDayLabel(n.logDate) ?? n.logDate} · ${enumLabel(n.shift)} shift`,
        content: { snippet: n.snippet, shift: n.shift, loggedByLabel: n.loggedByLabel },
      })),
    ...(detail.recentSafetyChecks ?? []).map((c) => ({
      kind: "check" as const,
      id: c.id,
      atIso: c.observedAtIso,
      label: c.observedLabel,
      content: c,
    })),
    ...(detail.recentVisits ?? []).map((v) => ({
      kind: "visit" as const,
      id: v.id,
      atIso: v.arrivedAtIso,
      label: v.arrivedLabel,
      content: v,
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
  const searchParams = useSearchParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { selectedFacilityId } = useFacilityStore();
  const bootstrapped = initialFacilityId !== undefined;

  const skipNextLoadRef = useRef(bootstrapped && initialError == null);

  const beginLoad = useLatestLoad();

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
  // COL-599: the period is the operator's choice, and the loader reads the same
  // span — widening it re-reads the record rather than relabelling old rows.
  const [activityDays, setActivityDays] = useState<ActivityFeedPeriodDays>(
    initialDetail?.activityDays ?? ACTIVITY_FEED_WINDOW_DAYS,
  );
  const [activityReloading, setActivityReloading] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  // COL-597: the in-place editor for one field, and Change bed opened from the unit gap.
  const [editorField, setEditorField] = useState<ResidentRecordField | null>(null);
  // COL-627: a save on the record re-reads its history, which the overview load does not carry.
  const [recordHistoryToken, setRecordHistoryToken] = useState(0);
  const [bedGapOpen, setBedGapOpen] = useState(false);
  const benefitsTasks = useResidentBenefitsTasks(residentId);

  const hrefs = useMemo(() => residentHrefSet(residentId, workspace), [residentId, workspace]);

  // Read by `load` without making the period a dependency: a change of period
  // is an explicit reload (below), not a reason to re-run the page's mount load.
  const activityDaysRef = useRef(activityDays);
  useEffect(() => {
    activityDaysRef.current = activityDays;
  }, [activityDays]);

  const load = useCallback(async (options?: { silent?: boolean; activityDays?: ActivityFeedPeriodDays }) => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId && options?.activityDays == null) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;
    const isCurrent = beginLoad();

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
      const row = await loadResidentOverviewDetail(residentId, selectedFacilityId, undefined, {
        activityDays: options?.activityDays ?? activityDaysRef.current,
      });
      if (!isCurrent()) return;
      if (!row) {
        setNotFound(true);
      } else {
        setDetail(row);
      }
    } catch (err) {
      if (!isCurrent()) return;
      setError(
        formatLiveDataLoadError(err, "Live resident profile is unavailable right now."),
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginLoad, residentId, selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAfterLog = useCallback(() => {
    void load({ silent: true });
  }, [load]);

  const onAfterRecordEdit = useCallback(() => {
    setRecordHistoryToken((token) => token + 1);
    void load({ silent: true });
  }, [load]);

  const onActivityPeriodChange = useCallback(
    (value: string) => {
      const days = Number(value);
      if (!isActivityFeedPeriod(days)) return;
      setActivityDays(days);
      activityDaysRef.current = days;
      setActivityReloading(true);
      void load({ silent: true, activityDays: days }).finally(() => setActivityReloading(false));
    },
    [load],
  );

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

  // The rows on screen were read for `detail.activityDays`; label that span, not
  // the one just picked while its reload is in flight.
  const feedWindow = activityFeedWindow(new Date(), detail.activityDays);
  const feedTruncatedCopy = activityFeedTruncatedCopy(detail.activityTruncatedKinds);
  const presenceSince = presenceSinceSummary(detail.presenceHistory, detail.rawStatus);
  const presenceLines = presenceHistoryLines(detail.presenceHistory);
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
    // COL-599: the global scope may say "All facilities", and this is the tab
    // every link to a resident lands on. The shell that carries the other tabs
    // has always named the building; the overview did not, so the one page an
    // operator opens first could not answer which house this person is in.
    detail.facilityName || "Facility not recorded",
    `Admitted ${detail.admissionLabel}`,
  ].join(" · ");

  const contactPrimaryCandidates = [...detail.contacts].filter((c) => c.isEmergencyContact).sort((a, b) => a.sortOrder - b.sortOrder);
  const primaryContactRow = contactPrimaryCandidates[0] ?? null;
  // COL-599: the loader's contact ladder falls back to the responsible party the
  // record holds in its own columns. Say so on the card — it is not a care
  // contact anyone has maintained, and it should be promoted to one.
  const primaryContactNote =
    primaryContactRow?.id === RESPONSIBLE_PARTY_CONTACT_ID ? RESPONSIBLE_PARTY_CONTACT_NOTE : null;
  const secondaryContactRow = contactPrimaryCandidates[1] ?? null;
  const poaRows = [...detail.contacts].filter((c) => c.isHealthcareProxy || c.isPowerOfAttorney);
  const poaPreferred = [...poaRows].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

  const carePlanAnnual =
    detail.carePlanAnnualDeltaDays != null ? classifyAnnualReview(detail.carePlanAnnualDeltaDays) : null;

  const openEditor = (field: ResidentRecordField) => setEditorField(field);
  const contactIntakeHref = residentIntakeCreateHref(detail.id);
  const taskItems = buildTaskItems(detail, hrefs, new Date(), benefitsTasks);
  const recordGaps = buildRecordGaps(
    detail,
    { carePlanHref: hrefs.carePlanHref, assessmentsHref: hrefs.assessmentsHref },
    NO_UNIT_COPY,
  );

  const polstMolst = polstMolstFriendly(detail.polstMolstRawStatus);
  const dietLower = detail.dietOrder?.toLowerCase() ?? "";
  // COL-597: both used to be inferred — the tube from a regex on the diet order,
  // DNH from "an advance directive is on file". Each now has its own recorded
  // value; the diet-order hint is kept only as a pointer while nothing is recorded.
  const tubeRecorded = detail.feedingTube != null;
  const tubeHint = tubeRecorded
    ? feedingTubeLabel(detail.feedingTube ?? null)
    : /tube|ng\s|gtube|peg|feeding\s+tube/i.test(dietLower)
      ? "Not recorded — the diet order mentions a tube"
      : "Not recorded";
  const dnhRecorded = detail.doNotHospitalize != null;
  const dnhPhrase = dnhLabel(detail.doNotHospitalize ?? null);

  const codeStatus = resolveCodeStatusPresentation(detail.codeStatusRaw);
  const codeVerified = verificationLabel("Verified", detail.codeStatusVerifiedAt, detail.codeStatusVerifiedByName);
  const allergyReviewed = verificationLabel("Reviewed", detail.allergyReviewedAt, detail.allergyReviewedByName);
  const diagnosesReviewed = verificationLabel("Updated", detail.diagnosesReviewedAt, detail.diagnosesReviewedByName);
  const diagnoses = recordedDiagnoses(detail.primaryDiagnosisRaw, detail.diagnosisListRaw);
  const acuity = acuityDisplay(detail.acuityLevel);

  const logActions = (
    <ResidentDocumentationActions
      onLogBehavior={() => setBehaviorModalOpen(true)}
      onLogCondition={() => setConditionModalOpen(true)}
      onGeneralNote={() => setGeneralNoteModalOpen(true)}
    />
  );

  const lifecycleMenu = isPresenceStatus(detail.rawStatus) ? (
    <ResidentLifecycleMenu
      residentId={detail.id}
      residentName={detail.fullName}
      facilityId={detail.facilityId}
      currentBedLabel={detail.roomLabel}
      status={detail.status}
      initialDialog={searchParams.get("changeBed") === "1" ? "bed" : null}
      onDone={onAfterLog}
      onMonitoringOrderDone={onMonitoringOrderChanged}
    />
  ) : null;

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
        className="mb-0"
        title={detail.fullName}
        subtitle={subtitleLine}
        backLink={{ label: "Resident roster", href: hrefs.rosterHref }}
        // Chips state what the resident *is*. Actions moved out of this slot in
        // COL-582: mixing a 44px button, a 32px button and bare text between the
        // name and the acuity is what made the header read as a toolbar.
        statusChips={
          <>
            {isPresenceStatus(detail.rawStatus) ? (
              <ResidentPresenceControl residentId={detail.id} status={detail.status} stayType={detail.bedHoldStayType} onChanged={onAfterLog} />
            ) : (
              <StatusPill tone="muted">{lifecycleStatusLabel(detail.rawStatus)}</StatusPill>
            )}
            {/* Only when acuity is actually posted. "No acuity posted" as bare
                grey text beside the name is what made the identity row read as
                unfinished; the care-summary strip below still states the gap
                and links to the assessments that would close it. */}
            {acuity.tone === "gap" ? null : <AcuityChip acuityLevel={detail.acuityLevel} />}
            {/* COL-599: since when, and who recorded it — after the chips, so the
                presence and acuity pills stay side by side. */}
            {isPresenceStatus(detail.rawStatus) ? <PresenceSinceNote summary={presenceSince} /> : null}
          </>
        }
        subtitleTrailing={
          <DobReveal dobLabel={detail.dobLabel} visible={dobVisible} onToggle={() => setDobVisible((v) => !v)} />
        }
        actions={
          <div className="hidden items-center gap-2 md:flex">
            {logActions}
            {lifecycleMenu}
          </div>
        }
      />

      {/* Narrow screens: the same actions as a full-width row under the identity block. */}
      <div className="-mt-1 grid grid-cols-2 gap-2 md:hidden" aria-label="Resident actions">
        {logActions}
        {lifecycleMenu}
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
                  <QuietButton onClick={() => openEditor("code_status")} label="Verify" />
                </div>
              )
            ) : (
              <QuietButton onClick={() => openEditor("code_status")} label="Record code status" />
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
              <QuietButton onClick={() => openEditor("allergy_list")} label="Record allergy review" />
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
            <ResidentFallRiskPresentation raw={detail.fallRiskRaw} assessed={hasFallRiskAssessment(detail.assessmentsUpcomingJson)} />
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
              <QuietButton onClick={() => openEditor("code_status")} label={codeVerified ? "Change" : codeStatus.label === "Not on file" ? "Record code status" : "Verify"} />
            </DirectiveRow>
            <DirectiveRow label="DNH (Do Not Hospitalize)" value={dnhPhrase} muted={!dnhRecorded}>
              <QuietButton onClick={() => openEditor("do_not_hospitalize")} label={dnhRecorded ? "Change" : "+ Record DNH"} />
            </DirectiveRow>
            <DirectiveRow label="POLST / MOLST" value={polstMolst} muted={polstMolst.startsWith("Not")}>
              <QuietButton onClick={() => openEditor("polst_molst")} label={polstMolst.startsWith("Not") ? "+ Record POLST / MOLST" : "Record a newer form"} />
            </DirectiveRow>
            <DirectiveRow label="Feeding tube" value={tubeHint} muted={!tubeRecorded}>
              {detail.feedingTubeNotes ? (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail.feedingTubeNotes}</p>
              ) : null}
              <QuietButton onClick={() => openEditor("feeding_tube")} label={tubeRecorded ? "Change" : "+ Record feeding tube"} />
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
              <QuietButton
                onClick={() => openEditor("hospice_status")}
                label={!detail.hospiceStatus || detail.hospiceStatus === "none" ? "+ Record hospice election" : "Change"}
              />
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
          <QuietButton
            onClick={() => openEditor("diagnoses")}
            label={diagnoses.conditions.length === 0 ? "+ Record diagnoses" : "Edit diagnoses"}
          />
        </Disclosure>

        <Disclosure title="Presence history">
          {presenceLines.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No presence changes recorded for this resident. When presence is changed from the header, the change,
              its time and who made it are recorded here.
            </p>
          ) : (
            <ol className="space-y-2" aria-label="Presence history, newest first">
              {presenceLines.map((line) => (
                <li key={line.id} className="text-[13px]">
                  <span className="font-medium text-foreground">{line.statusLabel}</span>
                  {line.current ? <span className="text-muted-foreground"> (current)</span> : null}
                  <span className="block text-[11px] tabular-nums text-muted-foreground">{line.spanLabel}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {line.recordedByLabel}
                    {line.reason ? ` · ${line.reason}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
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
            <DirectiveRow label="Fall risk" value={<ResidentFallRiskPresentation raw={detail.fallRiskRaw} assessed={hasFallRiskAssessment(detail.assessmentsUpcomingJson)} />} />
            <DirectiveRow label="Primary payer" value={detail.primaryPayer ?? "Not recorded"} muted={!detail.primaryPayer} />
          </div>
        </Disclosure>

        <Disclosure title="Record history">
          <ResidentRecordHistory residentId={detail.id} reloadToken={recordHistoryToken} />
        </Disclosure>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8" id="activity-timeline">
          <RecordDetailSection
            title="Recent activity"
            description={`${activityFeedPeriodLabel(detail.activityDays)} · ${feedWindow.label}`}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <label htmlFor="resident-activity-period" className="text-[12px] text-muted-foreground">
                  Period
                </label>
                <Select value={String(activityDays)} onValueChange={onActivityPeriodChange}>
                  <SelectTrigger
                    id="resident-activity-period"
                    aria-busy={activityReloading}
                    className="h-8 w-[140px] rounded-md border border-input bg-card px-3 text-[12px] shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_FEED_PERIOD_OPTIONS.map((days) => (
                      <SelectItem key={days} value={String(days)} className="text-[12px]">
                        {activityFeedPeriodLabel(days)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  Safety checks, behavior logs, condition changes, ADL refusals, general notes and visits recorded for {detail.fullName}{" "}
                  appear here. Nothing recorded in this period does not confirm an uneventful period.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <ResidentDocumentationActions
                    compact
                    onLogBehavior={() => setBehaviorModalOpen(true)}
                    onLogCondition={() => setConditionModalOpen(true)}
                    onGeneralNote={() => setGeneralNoteModalOpen(true)}
                  />
                </div>
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
            {feedTruncatedCopy ? (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground" role="note">
                {feedTruncatedCopy}{" "}
                <Link prefetch={false} href={hrefs.timelineHref} className="font-medium text-foreground underline-offset-4 hover:underline">
                  Open timeline
                </Link>
              </p>
            ) : null}
          </RecordDetailSection>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <RecordDetailSection title="Tasks and due dates">
            {taskItems.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                No due dates recorded. Care plan reviews, assessment due dates, the Form 1823, incident follow-ups and
                benefits renewals appear here once recorded.
              </p>
            ) : (
              <ul className="space-y-2 text-[12px]">
                {(showAllTasks ? taskItems : taskItems.slice(0, 6)).map((task) => (
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
            {/* The list now spans several clocks, so "view all" can no longer mean
                "open assessments" — it expands the list in place. */}
            {taskItems.length > 6 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={showAllTasks}
                className="mt-2 h-8 px-2 text-[12px]"
                onClick={() => setShowAllTasks((v) => !v)}
              >
                {showAllTasks ? "Show fewer" : `Show all (${taskItems.length})`}
              </Button>
            ) : null}
          </RecordDetailSection>

          <RecordDetailSection title="Care contacts">
            <ContactBlock
              tier="Primary contact"
              row={primaryContactRow}
              note={primaryContactNote}
              onOpen={() => primaryContactRow && setContactModal(primaryContactRow)}
              emptyHref={contactIntakeHref}
              emptyCopy="+ Add primary contact (admission documents)"
            />
            <ContactBlock
              tier="Secondary contact"
              row={secondaryContactRow}
              onOpen={() => secondaryContactRow && setContactModal(secondaryContactRow)}
              emptyHref={contactIntakeHref}
              emptyCopy="+ Add secondary contact (admission documents)"
            />
            <ContactBlock
              tier="POA / healthcare proxy"
              row={poaPreferred}
              onOpen={() => poaPreferred && setContactModal(poaPreferred)}
              emptyHref={contactIntakeHref}
              emptyCopy="+ Add POA (admission documents)"
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
                <QuietButton onClick={() => openEditor("primary_physician")} label="+ Add primary care physician" />
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Specialist consults on file: <span className="font-semibold text-foreground">{formatResidentOverviewSpecialistCount(detail.specialistConsultActiveCount)}</span>
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
                      <GapControl
                        label={gap.label}
                        action={gap.action}
                        onEditor={openEditor}
                        onBed={isPresenceStatus(detail.rawStatus) ? () => setBedGapOpen(true) : null}
                      />
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

      <ResidentRecordFactDialog
        field={editorField}
        detail={detail}
        onOpenChange={(open) => !open && setEditorField(null)}
        onSaved={onAfterRecordEdit}
      />
      {isPresenceStatus(detail.rawStatus) ? (
        <ChangeBedAction
          residentId={detail.id}
          residentName={detail.fullName}
          facilityId={detail.facilityId}
          currentBedLabel={detail.roomLabel}
          hideTrigger
          open={bedGapOpen}
          onOpenChange={setBedGapOpen}
          onDone={onAfterLog}
        />
      ) : null}
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

function PresenceSinceNote({ summary }: { summary: ReturnType<typeof presenceSinceSummary> }) {
  const parts = [summary.sinceLabel, summary.awayDayLabel, summary.recordedByLabel].filter(Boolean);
  return <span className="text-[12px] leading-snug text-muted-foreground">{parts.join(" · ")}</span>;
}

function DobReveal({ dobLabel, visible, onToggle }: { dobLabel: string; visible: boolean; onToggle: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
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

function QuietButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-0.5 inline-flex rounded-sm text-left text-[11px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}

const GAP_CONTROL_CLASS =
  "rounded-sm text-left text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function GapControl({ label, action, onEditor, onBed }: {
  label: string;
  action: GapAction;
  onEditor: (field: ResidentRecordField) => void;
  onBed: (() => void) | null;
}) {
  if (action.kind === "href") {
    return (
      <Link prefetch={false} href={action.href} className={GAP_CONTROL_CLASS}>
        {label}
      </Link>
    );
  }
  if (action.kind === "bed") {
    // A discharged resident has no bed to assign; say the gap, offer nothing false.
    if (!onBed) return <span className="text-foreground">{label}</span>;
    return (
      <button type="button" onClick={onBed} className={GAP_CONTROL_CLASS}>
        {label} <span className="text-muted-foreground">— change bed</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onEditor(action.field)} className={GAP_CONTROL_CLASS}>
      {label}
    </button>
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
  /** Where this row came from, when it is not a maintained care contact. */
  note?: string | null;
}) {
  const { tier, row, onOpen, emptyHref, emptyCopy, note } = props;
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
      {row && note ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>
      ) : null}
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
  if (item.kind === "check") {
    const c = item.content;
    return (
      <div key={`check-${c.id}-${idx}`} className="flex gap-4">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", c.somethingWrong ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
          <ShieldCheck className="size-4" aria-hidden />
        </div>
        <div className={cn("min-w-0 flex-1 rounded-[8px] border bg-card p-3 shadow-[var(--shadow-card)]", c.somethingWrong ? "border-warning/20" : "border-border")}>
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              Safety check
              {c.somethingWrong ? <span className="ml-1 text-[11px] font-semibold text-warning">(something wrong)</span> : null}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">{c.summary}</p>
          {c.note ? <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">Note: {c.note}</p> : null}
          <p className="text-[11px] text-muted-foreground">Charted by {c.chartedByLabel}</p>
        </div>
      </div>
    );
  }
  if (item.kind === "visit") {
    const v = item.content;
    return (
      <div key={`visit-${v.id}-${idx}`} className="flex gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <DoorOpen className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-[8px] border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              Visit <span className="ml-1 text-[11px] font-semibold text-muted-foreground">({v.typeLabel})</span>
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
          </div>
          <p className="mb-2 text-[12px] leading-relaxed text-muted-foreground">
            {v.visitorCompany ? `${v.visitorName} · ${v.visitorCompany}` : v.visitorName}
            {v.purpose ? ` · ${v.purpose}` : null}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {v.leftLabel ? `Left ${v.leftLabel}` : "Not signed out"}
            {v.symptomsReported ? (
              <>
                {" "}
                · <span className="font-semibold text-warning">reported symptoms at sign-in</span>
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
