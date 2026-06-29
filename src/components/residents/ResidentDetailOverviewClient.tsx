"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Brain,
  ClipboardList,
  FileText,
  Stethoscope,
  User,
  CheckCircle2,
} from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { BehaviorLogModal, ConditionLogModal, GeneralNoteModal } from "@/components/admin/resident-log-modals";
import {
  ResidentCodeStatusValue,
  ResidentFallRiskPresentation,
  hospiceElectionPhrase,
  polstMolstFriendly,
} from "@/components/residents/resident-clinical-overview-widgets";
import { ResidentDetailTabStrip, type ResidentDetailHrefConfig } from "@/components/residents/ResidentDetailTabStrip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DX_CATEGORY_RENDER_ORDER,
  diagnosisDisplayTitle,
  groupDiagnosesByCategory,
} from "@/lib/residents/clinical-text-format";
import { rosterAvatarAccentFromId } from "@/lib/residents/roster-format";
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
    billingHref: `${canonical}/billing`,
  };
}

function genderFriendly(value: string | null): string {
  switch (value) {
    case "male":
      return "Male";
    case "female":
      return "Female";
    default:
      return value?.replace(/_/g, " ") ?? "Unknown";
  }
}

function isoDayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function verificationFooter(label: string, iso: string | null, actor: string | null): string {
  const day = isoDayLabel(iso);
  const who = actor?.trim().length ? actor : "Staff (not attributed)";
  if (!day) return `${label} pending — capture verification in profile editor.`;
  return `${label} ${day} by ${who}.`;
}

function severityClinicalLabel(raw: string): string {
  return diagnosisDisplayTitle(raw.replace(/_/g, " "));
}

function ResidentStatusInline({ detail }: { detail: ResidentOverviewDetail }) {
  if (detail.status === "hospital") {
    return <StatusPill tone="danger">Out at hospital</StatusPill>;
  }
  if (detail.status === "loa") {
    return <StatusPill tone="muted">On leave</StatusPill>;
  }
  return <span className="text-[13px] text-muted-foreground">In facility</span>;
}

function AcuityInline({ acuity }: { acuity: number }) {
  if (acuity >= 3) {
    return (
      <StatusPill tone="danger" className="normal-case tracking-tight">
        Acuity {acuity}
      </StatusPill>
    );
  }
  if (acuity === 2) {
    return (
      <StatusPill tone="warning" className="normal-case tracking-tight">
        Acuity {acuity}
      </StatusPill>
    );
  }
  return <span className="text-[13px] text-muted-foreground">Acuity level 1</span>;
}

type TaskTone = "danger" | "warning" | "muted";

function buildTaskItems(detail: ResidentOverviewDetail): Array<{ id: string; title: string; tone: TaskTone; sub: string }> {
  const items: Array<{ id: string; title: string; tone: TaskTone; sub: string }> = [];
  const cpDelta = detail.carePlanAnnualDeltaDays;
  if (cpDelta != null) {
    const cls = classifyAnnualReview(cpDelta);
    if (cls.kind === "overdue") {
      items.push({
        id: "cp-over",
        title: "Annual care plan review",
        tone: "danger",
        sub: `${cls.days} days overdue`,
      });
    } else if (cls.kind === "dueToday") {
      items.push({
        id: "cp-today",
        title: "Annual care plan review",
        tone: "danger",
        sub: "Due today",
      });
    } else if (cls.kind === "approaching") {
      items.push({
        id: "cp-soon",
        title: "Annual care plan review",
        tone: "warning",
        sub: `${cls.days} days until due`,
      });
    } else {
      items.push({
        id: "cp-ok",
        title: "Annual care plan review",
        tone: "muted",
        sub: ">30 days before due window",
      });
    }
  }

  detail.assessmentsUpcomingJson
    .slice(0, 3)
    .forEach((row, idx) => {
      const dueIso = row.nextDue;
      if (!dueIso) return;
      const due = new Date(`${dueIso}T12:00:00`);
      const now = new Date();
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
      });
    });

  items.push({
    id: "med-review",
    title: "Medication regimen review",
    tone: "muted",
    sub: "Confirm scope in eMAR tooling",
  });
  items.push({
    id: "vitals",
    title: "Vitals checkpoints",
    tone: "muted",
    sub: "Follow vitals cadence protocol",
  });

  items.sort((a, b) => {
    const order = { danger: 0, warning: 1, muted: 2 };
    return order[a.tone] - order[b.tone];
  });
  return items;
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

  const hrefs = useMemo(() => residentHrefSet(residentId, workspace), [residentId, workspace]);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setLoading(true);
    setError(null);
    setNotFound(false);
    setDetail(null);

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
    void load();
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

  const feedItems = [
    ...detail.recentConditionChanges.map((c) => ({
      type: "condition" as const,
      time: new Date(c.reportedLabel).getTime() || 0,
      label: c.reportedLabel,
      content: c,
    })),
    ...detail.recentBehavior.map((b) => ({
      type: "behavior" as const,
      time: new Date(b.occurredLabel).getTime() || 0,
      label: b.occurredLabel,
      content: b,
    })),
    ...detail.recentAdl
      .filter((a) => a.summary.includes("refused"))
      .map((a) => ({
        type: "adl" as const,
        time: new Date(a.logTimeLabel).getTime() || 0,
        label: a.logTimeLabel,
        content: a,
      })),
  ].sort((a, b) => b.time - a.time);

  const subtitleLine = `${detail.ageYears != null ? `Age ${detail.ageYears}` : "Age pending"} · ${genderFriendly(detail.gender)} · Room ${detail.roomLabel} · Admitted ${detail.admissionLabel}`;

  const accent = rosterAvatarAccentFromId(detail.id);
  const dxBuckets = groupDiagnosesByCategory(detail.diagnosisRawList.length ? detail.diagnosisRawList : []);

  const contactPrimaryCandidates = [...detail.contacts].filter((c) => c.isEmergencyContact).sort((a, b) => a.sortOrder - b.sortOrder);
  const primaryContactRow = contactPrimaryCandidates[0] ?? null;
  const secondaryContactRow = contactPrimaryCandidates[1] ?? null;
  const poaRows = [...detail.contacts].filter((c) => c.isHealthcareProxy || c.isPowerOfAttorney);
  const poaPreferred = [...poaRows].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

  const carePlanAnnual =
    detail.carePlanAnnualDeltaDays != null ? classifyAnnualReview(detail.carePlanAnnualDeltaDays) : null;

  const taskItems = buildTaskItems(detail);
  const timelineEmpty = feedItems.length === 0;

  const polstMolst = polstMolstFriendly(detail.polstMolstRawStatus);
  const dietLower = detail.dietOrder?.toLowerCase() ?? "";
  const tubeHint =
    /tube|ng\s|gtube|peg|feeding\s+tube/i.test(dietLower) ? "Entered on diet orders" : "Not on file";
  const dnhPhrase = detail.advanceDirectiveOnFile ? "Captured on file" : "Not on file";

  const profileEditHref = `/admin/v2/residents/${residentId}`;

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
                {contactModal.relationship ?? "Relationship pending"} · {contactModal.phone ?? "Phone pending"}
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
          detail.status === "hospital" ? (
            <StatusPill tone="danger">Hospital hold</StatusPill>
          ) : null
        }
        actions={
          <div className="flex shrink-0 flex-col items-end gap-2 md:flex-row md:items-start">
            <div className="flex flex-row flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setBehaviorModalOpen(true)}
                className="hover:bg-secondary/70 h-auto min-w-[134px] max-w-[150px] border border-transparent px-3 py-2 text-[12px] font-medium hover:border-border"
              >
                <Brain className="mr-1.5 size-4" aria-hidden /> Log behavior
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConditionModalOpen(true)}
                className="hover:bg-secondary/70 h-auto min-w-[134px] max-w-[150px] border border-transparent px-3 py-2 text-[12px] font-medium hover:border-border"
              >
                <Stethoscope className="mr-1.5 size-4" aria-hidden /> Log condition
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setGeneralNoteModalOpen(true)}
                className="hover:bg-secondary/70 h-auto min-w-[134px] max-w-[150px] border border-transparent px-3 py-2 text-[12px] font-medium hover:border-border"
              >
                <FileText className="mr-1.5 size-4" aria-hidden /> General note
              </Button>
            </div>
          </div>
        }
      />

      <div className="w-full shrink-0">
        <ResidentDetailTabStrip hrefs={hrefs} active="overview" />
      </div>

      <div className="grid flex-1 grid-cols-1 gap-5 lg:min-h-[480px] lg:grid-cols-12 lg:gap-6">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <div className="border-border shadow-[var(--shadow-card)] scrollbar-hide flex flex-col overflow-hidden rounded-[8px] border bg-card">
            <div className="border-border bg-muted/50 border-b p-[14px]">
              <div className="flex items-start gap-4">
                <Avatar className="border-border shadow-[var(--shadow-card)] h-16 w-16 border">
                  <AvatarImage src={detail.photoUrl ?? undefined} alt={detail.fullName} />
                  <AvatarFallback
                    style={{ backgroundColor: accent.background, color: accent.foreground }}
                    className="text-[15px] font-semibold"
                  >
                    {detail.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="mt-1 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ResidentStatusInline detail={detail} />
                    <AcuityInline acuity={detail.acuity} />
                  </div>
                  <TooltipDob dobLabel={detail.dobLabel} />
                </div>
              </div>
            </div>
            <div className="space-y-6 p-[14px]">
              <div id="directives-anchor" />
              <div>
                <p className="text-muted-foreground mb-2 text-[12px] font-semibold tracking-tight">
                  Advance directives
                </p>
                <div className="space-y-3 text-[13px] leading-relaxed">
                  <DirectiveRow label="Code status" value={<ResidentCodeStatusValue raw={detail.codeStatusRaw} />}>
                    <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                      {verificationFooter("Last verified", detail.codeStatusVerifiedAt, detail.codeStatusVerifiedByName)}
                    </p>
                  </DirectiveRow>
                  <DirectiveRow label="DNH (Do Not Hospitalize)" value={dnhPhrase} muted={!detail.advanceDirectiveOnFile}>
                    {!detail.advanceDirectiveOnFile ? (
                      <GhostAdd href={profileEditHref} label="+ Add DNH notation" />
                    ) : null}
                  </DirectiveRow>
                  <DirectiveRow label="POLST / MOLST" value={polstMolst} muted={polstMolst.startsWith("Not")}>
                    {polstMolst.startsWith("Not") ? <GhostAdd href={profileEditHref} label="+ Add directive document" /> : null}
                  </DirectiveRow>
                  <DirectiveRow label="Feeding tube" value={tubeHint} muted={tubeHint.includes("Not")}>
                    {tubeHint.includes("Not") ? <GhostAdd href={profileEditHref} label="+ Add tube details" /> : null}
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
                      <GhostAdd href={profileEditHref} label="+ Add hospice intake" />
                    ) : null}
                  </DirectiveRow>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground mb-2 text-[12px] font-semibold tracking-tight">
                  Allergies
                </p>
                {detail.allergiesTokens.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">NKDA / no known drug allergies documented</p>
                ) : (
                  <StatusPill tone="danger">{detail.allergiesTokens.map((t) => diagnosisDisplayTitle(t)).join("; ")}</StatusPill>
                )}
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {verificationFooter("Last reviewed", detail.allergyReviewedAt, detail.allergyReviewedByName)}
                </p>
              </div>

              <div>
                <p className="text-muted-foreground mb-2 text-[12px] font-semibold tracking-tight">
                  Primary diagnoses
                </p>
                <div className="space-y-3">
                  {DX_CATEGORY_RENDER_ORDER.map((cat) => {
                    const list = dxBuckets[cat];
                    if (!list?.length) return null;
                    return (
                      <div key={cat}>
                        <p className="text-muted-foreground mb-1 text-[11px] font-semibold">{cat}</p>
                        <div className="flex flex-wrap gap-1">
                          {list.map((phrase) => (
                            <span
                              key={phrase}
                              className="text-foreground mr-2 inline-block rounded-sm bg-muted/40 px-2 py-0.5 text-[11px]"
                            >
                              {phrase}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {!DX_CATEGORY_RENDER_ORDER.some((cat) => dxBuckets[cat]?.length) ? (
                    <p className="text-[13px] text-muted-foreground">No diagnoses documented</p>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {verificationFooter("Last updated", detail.diagnosesReviewedAt, detail.diagnosesReviewedByName)}
                </p>
              </div>

              <div>
                <p className="text-muted-foreground mb-2 text-[12px] font-semibold tracking-tight">
                  Contacts
                </p>
                <ContactBlock
                  tier="Primary"
                  row={primaryContactRow}
                  onOpen={() => primaryContactRow && setContactModal(primaryContactRow)}
                />
                <ContactBlock
                  tier="Secondary"
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
              </div>
              <span id="contacts" />
            </div>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-col overflow-hidden lg:col-span-6",
            timelineEmpty && "lg:max-h-[220px]",
          )}
          id="activity-timeline"
        >
          <RecordDetailSection
            title="Activity timeline"
            className={timelineEmpty ? "border border-dashed border-border/70" : undefined}
          >
            <div
              className={cn(
                "scrollbar-hide -mx-[14px] min-h-0 space-y-4 overflow-y-auto px-[14px]",
                timelineEmpty ? "max-h-[180px]" : "max-h-[560px]",
              )}
            >
              {timelineEmpty ? (
                <div className="text-muted-foreground flex flex-col items-start gap-3 py-3">
                  <CheckCircle2 className="opacity-70 size-9" aria-hidden />
                  <p className="text-[13px] font-medium leading-relaxed">
                    Quiet shift — log behavior/condition/note using the compact actions above to build this feed.
                  </p>
                  {detail.recentDailyNotes[0] ? (
                    <div className="border-border rounded-md border bg-card/70 p-3 text-[11px]">
                      <p className="text-muted-foreground mb-1">Latest daily note excerpt</p>
                      <p className="leading-relaxed">{detail.recentDailyNotes[0]?.snippet ?? "—"}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                feedItems.map((item, idx) => renderFeedItem(item, idx))
              )}
            </div>
          </RecordDetailSection>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-3">
          <RecordDetailSection title="Location">
            <div className="space-y-4 text-[13px]">
              <div>
                <p className="text-muted-foreground mb-1 text-[12px] font-semibold">Unit</p>
                <p className="font-medium">{detail.unitName}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-[12px] font-semibold">Room & bed</p>
                <p className="font-medium">{detail.roomLabel}</p>
              </div>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Care team">
            <div className="space-y-3 text-[13px]">
              <div>
                <p className="text-muted-foreground mb-1 text-[12px] font-semibold">Primary care physician</p>
                <p className="font-medium">{detail.primaryPhysicianName ?? "Not on file"}</p>
                <p className="text-muted-foreground text-[12px]">{detail.primaryPhysicianPhone ?? "Phone pending"}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-[12px] font-semibold">Last visit</p>
                <p className="text-muted-foreground">Not tracked in Haven yet.</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-[12px] font-semibold">Next visit</p>
                <p className="text-muted-foreground">Not scheduled</p>
              </div>
              <div className="text-muted-foreground text-[11px]">
                Specialist consults on file:&nbsp;<span className="text-foreground font-semibold">{detail.specialistConsultActiveCount}</span>
              </div>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Due soon / tasks">
            <ul className="space-y-2 text-[12px]">
              {taskItems.slice(0, 5).map((task) => (
                <li key={task.id} className="flex gap-2">
                  <span
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      task.tone === "danger" ? "bg-destructive" : task.tone === "warning" ? "bg-warning" : "bg-muted-foreground",
                    )}
                  />
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-muted-foreground">{task.sub}</p>
                  </div>
                </li>
              ))}
            </ul>
            {taskItems.length > 5 ? (
              <Link prefetch={false} href={`${hrefs.assessmentsHref}`} className="mt-3 inline-block text-[12px] font-medium underline-offset-4 hover:underline">
                View all ({taskItems.length})
              </Link>
            ) : null}
          </RecordDetailSection>

          <RecordDetailSection title="Active orders">
            <div className="space-y-5 text-[13px]">
              <div>
                <p className="text-muted-foreground mb-2 text-[12px] font-semibold">Diet order</p>
                <p className="font-medium">{diagnosisDisplayTitle(detail.dietOrder ?? "") || "Regular"}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-2 text-[12px] font-semibold">Fall risk</p>
                <ResidentFallRiskPresentation raw={detail.fallRiskRaw} />
              </div>

              <div>
                <p className="text-muted-foreground mb-3 inline-flex items-center gap-1.5 text-[12px] font-semibold">
                  <ClipboardList className="size-3.5" aria-hidden />
                  Care plan status
                </p>
                <div className="bg-muted rounded-[8px] border border-border p-3 space-y-2">
                  <p className="text-[14px] font-semibold leading-tight">
                    {detail.carePlanVersion != null ? `Active v${detail.carePlanVersion}` : "Care plan inactive"}
                  </p>
                  {detail.carePlanEffectiveDate ? (
                    <p className="text-muted-foreground text-[11px]">
                      Effective {isoDayLabel(detail.carePlanEffectiveDate)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-[11px]">No activated plan on record.</p>
                  )}
                  <div className="pt-2">
                    {detail.carePlanAnnualDeltaDays == null || carePlanAnnual == null ? (
                      <span className="text-muted-foreground text-[12px]">Annual review pacing unavailable.</span>
                    ) : carePlanAnnual.kind === "overdue" ? (
                      <StatusPill tone="danger">Review overdue by {carePlanAnnual.days} days</StatusPill>
                    ) : carePlanAnnual.kind === "dueToday" ? (
                      <StatusPill tone="danger">Review due today</StatusPill>
                    ) : carePlanAnnual.kind === "approaching" ? (
                      <StatusPill tone="warning">Review due in {carePlanAnnual.days} days</StatusPill>
                    ) : (
                      <span className="text-muted-foreground text-[12px]">Annual review beyond 30-day window.</span>
                    )}
                  </div>
                  <Link prefetch={false} href={hrefs.carePlanHref} className="text-primary inline-flex text-[12px] font-medium underline-offset-4 hover:underline">
                    → Open care plan
                  </Link>
                </div>
              </div>
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

function TooltipDob({ dobLabel }: { dobLabel: string }) {
  return (
    <span
      className="text-muted-foreground cursor-help align-middle text-[11px] underline-offset-4"
      title={`Date of birth (not shown inline): ${dobLabel}`}
    >
      DOB — hover label
    </span>
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
      <p className={cn("text-muted-foreground text-[11px] font-semibold", muted && "opacity-75")}>{label}</p>
      <div className="text-[13px] font-medium">{value}</div>
      {children}
    </div>
  );
}

function GhostAdd({ href, label }: { href: string; label: string }) {
  return (
    <Link prefetch={false} href={href} className="mt-1 inline-flex text-[11px] font-medium text-muted-foreground underline-offset-4 hover:underline">
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
    <div className="border-border mb-3 border-b pb-3">
      <p className="text-muted-foreground mb-2 text-[11px] font-semibold">{tier}</p>
      {row ? (
        <button type="button" onClick={onOpen} className="text-[13px] font-medium underline-offset-4 hover:underline text-left leading-relaxed">
          {row.name} <span className="text-muted-foreground">({row.relationship ?? "Relation pending"})</span>
          <br />
          <span className="text-muted-foreground text-[11px]">
            {row.phone ?? "Phone pending"} · Last contact {isoDayLabel(row.updatedAt) ?? "pending"}
          </span>
        </button>
      ) : emptyHref ? (
        <GhostAdd href={emptyHref} label={emptyCopy ?? "+ Add"} />
      ) : (
        <p className="text-muted-foreground text-[13px]">Not on file</p>
      )}
    </div>
  );
}

function renderFeedItem(
  item:
    | { type: "condition"; label: string; content: ConditionEventContent }
    | { type: "behavior"; label: string; content: BehaviorEventContent }
    | { type: "adl"; label: string; content: ADLEventContent },
  idx: number,
) {
  if (item.type === "condition") {
    const c = item.content;
    return (
      <div key={`cond-${c.id}-${idx}`} className="flex gap-4">
        <div className="bg-destructive/10 text-destructive flex size-8 shrink-0 items-center justify-center rounded-full">
          <Stethoscope className="size-4" />
        </div>
        <div className="bg-card rounded-[8px] border border-destructive/20 p-3 shadow-[var(--shadow-card)]">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {c.typeLabel}{" "}
              <span className="text-destructive ml-1 text-[11px] font-semibold normal-case">
                ({severityClinicalLabel(c.severity)})
              </span>
            </span>
            <span className="text-muted-foreground text-[11px] tabular-nums">{item.label}</span>
          </div>
          <p className="text-muted-foreground mb-2 text-[12px] leading-relaxed">{c.description}</p>
          <p className="text-muted-foreground text-[11px]">
            Logged by {c.loggedByLabel} {c.nurseNotified ? " · MD notified" : null}
          </p>
        </div>
      </div>
    );
  }
  if (item.type === "behavior") {
    const b = item.content;
    return (
      <div key={`beh-${b.id}-${idx}`} className="flex gap-4">
        <div className="bg-warning/10 text-warning flex size-8 shrink-0 items-center justify-center rounded-full">
          <Brain className="size-4" />
        </div>
        <div className="bg-card rounded-[8px] border border-warning/20 p-3 shadow-[var(--shadow-card)]">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="font-semibold text-[13px] text-foreground">{b.typeLabel}</span>
            <span className="text-muted-foreground text-[11px] tabular-nums">{item.label}</span>
          </div>
          <p className="text-muted-foreground mb-2 text-[12px] leading-relaxed">{b.behaviorText}</p>
          <p className="text-muted-foreground text-[11px]">
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
  const a = item.content as ADLEventContent;
  return (
    <div key={`adl-${a.id}-${idx}`} className="flex gap-4">
      <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
        <User className="size-4" />
      </div>
      <div className="bg-card rounded-[8px] border border-border p-3 shadow-[var(--shadow-card)]">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <span className="font-semibold text-[13px] text-foreground">{a.summary}</span>
          <span className="text-muted-foreground text-[11px] tabular-nums">{item.label}</span>
        </div>
        <p className="text-muted-foreground mt-1 text-[11px]">Logged by {a.loggedByLabel}</p>
      </div>
    </div>
  );
}

export default ResidentDetailOverviewClient;
