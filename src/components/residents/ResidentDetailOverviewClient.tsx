"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Brain,
  FileText,
  Stethoscope,
  User,
} from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { BehaviorLogModal, ConditionLogModal, GeneralNoteModal } from "@/components/admin/resident-log-modals";
import {
  ResidentFallRiskPresentation,
  hospiceElectionPhrase,
  polstMolstFriendly,
} from "@/components/residents/resident-clinical-overview-widgets";
import { ResidentDetailTabStrip, type ResidentDetailHrefConfig } from "@/components/residents/ResidentDetailTabStrip";
import { ResidentPresenceControl } from "@/components/residents/ResidentPresenceControl";
import { HoldDeclineReturnButton } from "@/components/residents/HoldDeclineReturnButton";
import { ResidentIntakeLinks } from "@/components/resident-intake";
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
import { resolveCodeStatusPresentation } from "@/lib/residents/resident-code-status";
import {
  loadResidentOverviewDetail,
  type ADLEventContent,
  type BehaviorEventContent,
  type ConditionEventContent,
  type ResidentContactRowView,
  type ResidentOverviewDetail,
} from "@/lib/residents/resident-detail-overview-load";
import { diagnosisDisplayTitle } from "@/lib/residents/clinical-text-format";
import { rosterAvatarAccentFromId } from "@/lib/residents/roster-format";
import {
  formatResidentOverviewGenderLabel,
  RESIDENT_OVERVIEW_LOADING_COPY,
} from "@/lib/residents/resident-overview-display-copy";
import {
  buildOverviewAttentionItems,
  buildOverviewCompletenessItems,
  formatCodeStatusHeadline,
  formatCodeStatusVerificationLabel,
  formatOverviewAgeDobLine,
  formatOverviewDayLabel,
  formatOverviewIdentitySubtitle,
  formatResidentOverviewActivityEmptyCopy,
  isTimestampInActivityWindow,
  overviewAllergyPresentation,
  overviewAttentionEmptyCopy,
  recordedDiagnosisPhrases,
  residentOverviewActivityWindow,
} from "@/lib/residents/resident-overview-presentation";
import { isPresenceStatus, lifecycleStatusLabel } from "@/lib/residents/presence";
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

function severityClinicalLabel(raw: string): string {
  return diagnosisDisplayTitle(raw.replace(/_/g, " "));
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
  return <span className="text-[13px] font-medium text-foreground">Acuity 1</span>;
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
  const profileHref = `/admin/v2/residents/${residentId}`;
  const activityWindow = useMemo(() => residentOverviewActivityWindow(), []);

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
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const onAfterLog = useCallback(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="fade-in animate-in space-y-4 duration-[var(--motion-duration)]">
        <Link
          prefetch={false}
          href={hrefs.rosterHref}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex min-h-11 gap-1")}
        >
          ← Resident roster
        </Link>
        <div role="status" aria-live="polite" className="space-y-3">
          <p className="text-sm text-muted-foreground">{RESIDENT_OVERVIEW_LOADING_COPY}</p>
          <AdminTableLoadingState />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="fade-in animate-in space-y-4 duration-[var(--motion-duration)]">
        <Link prefetch={false} href={hrefs.rosterHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 gap-1")}>
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
      <div className="fade-in animate-in space-y-4 duration-[var(--motion-duration)]">
        <Link prefetch={false} href={hrefs.rosterHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 gap-1")}>
          ← Resident roster
        </Link>
        {error ? (
          <div role="alert">
            <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
          </div>
        ) : null}
      </div>
    );
  }

  const feedItems = [
    ...detail.recentConditionChanges.map((c) => ({
      type: "condition" as const,
      time: new Date(c.occurredAtIso).getTime() || 0,
      occurredAtIso: c.occurredAtIso,
      label: c.reportedLabel,
      content: c,
    })),
    ...detail.recentBehavior.map((b) => ({
      type: "behavior" as const,
      time: new Date(b.occurredAtIso).getTime() || 0,
      occurredAtIso: b.occurredAtIso,
      label: b.occurredLabel,
      content: b,
    })),
    ...detail.recentAdl
      .filter((a) => a.summary.includes("refused"))
      .map((a) => ({
        type: "adl" as const,
        time: new Date(a.occurredAtIso).getTime() || 0,
        occurredAtIso: a.occurredAtIso,
        label: a.logTimeLabel,
        content: a,
      })),
    ...detail.recentDailyNotes.map((note) => ({
      type: "note" as const,
      time: new Date(note.occurredAtIso).getTime() || 0,
      occurredAtIso: note.occurredAtIso,
      label: formatOverviewDayLabel(note.logDate) ?? note.logDate,
      content: note,
    })),
  ]
    .filter((item) => isTimestampInActivityWindow(item.occurredAtIso, activityWindow))
    .sort((a, b) => b.time - a.time);

  const identitySubtitle = formatOverviewIdentitySubtitle(detail);
  const ageDobLine = formatOverviewAgeDobLine(
    detail,
    formatResidentOverviewGenderLabel(detail.gender),
  );
  const accent = rosterAvatarAccentFromId(detail.id);
  const diagnosisPhrases = recordedDiagnosisPhrases(detail.diagnosisRawList);
  const allergies = overviewAllergyPresentation(detail);
  const codeHeadline = formatCodeStatusHeadline(
    detail.codeStatusRaw,
    detail.codeStatusVerifiedAt,
    detail.codeStatusVerifiedByName,
  );
  const codeSemantic = resolveCodeStatusPresentation(detail.codeStatusRaw).semantic;

  const contactPrimaryCandidates = [...detail.contacts].filter((c) => c.isEmergencyContact).sort((a, b) => a.sortOrder - b.sortOrder);
  const primaryContactRow = contactPrimaryCandidates[0] ?? null;
  const secondaryContactRow = contactPrimaryCandidates[1] ?? null;
  const poaRows = [...detail.contacts].filter((c) => c.isHealthcareProxy || c.isPowerOfAttorney);
  const poaPreferred = [...poaRows].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

  const attentionItems = buildOverviewAttentionItems(detail, {
    carePlanHref: hrefs.carePlanHref,
    assessmentsHref: hrefs.assessmentsHref,
    profileHref,
  });
  const completenessItems = buildOverviewCompletenessItems(detail, profileHref);
  const timelineEmpty = feedItems.length === 0;
  const polstMolst = polstMolstFriendly(detail.polstMolstRawStatus);
  const dietLower = detail.dietOrder?.toLowerCase() ?? "";
  const tubeHint = /tube|ng\s|gtube|peg|feeding\s+tube/i.test(dietLower)
    ? "Entered on diet orders"
    : "Not on file";

  const documentationActions = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button
        type="button"
        variant="outline"
        onClick={() => setBehaviorModalOpen(true)}
        className="min-h-11 justify-center px-4 text-sm font-medium"
      >
        <Brain className="mr-1.5 size-4" aria-hidden />
        Log behavior
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => setConditionModalOpen(true)}
        className="min-h-11 justify-center px-4 text-sm font-medium"
      >
        <Stethoscope className="mr-1.5 size-4" aria-hidden />
        Log condition
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => setGeneralNoteModalOpen(true)}
        className="min-h-11 justify-center px-4 text-sm font-medium"
      >
        <FileText className="mr-1.5 size-4" aria-hidden />
        Add note
      </Button>
    </div>
  );

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-4 pt-2">
      <Dialog open={contactModal != null} onOpenChange={(open) => !open && setContactModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{contactModal?.name}</DialogTitle>
          </DialogHeader>
          {contactModal ? (
            <div className="space-y-3 text-[13px] text-foreground">
              <p className="text-muted-foreground">
                {contactModal.relationship ?? "Relationship pending"} · {contactModal.phone ?? "Phone pending"}
              </p>
              <p className="text-muted-foreground">
                Last contact {formatOverviewDayLabel(contactModal.updatedAt) ?? "not recorded"}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <RecordDetailHeader
        title={detail.fullName}
        subtitle={identitySubtitle}
        backLink={{ label: "Resident roster", href: hrefs.rosterHref }}
        className="mb-0"
        statusChips={
          isPresenceStatus(detail.rawStatus) ? (
            <div className="flex flex-wrap items-center gap-2">
              <ResidentPresenceControl
                residentId={detail.id}
                status={detail.status}
                onChanged={onAfterLog}
              />
              <HoldDeclineReturnButton
                residentId={detail.id}
                status={detail.status}
                onDone={onAfterLog}
              />
            </div>
          ) : (
            <StatusPill tone="muted">{lifecycleStatusLabel(detail.rawStatus)}</StatusPill>
          )
        }
        actions={documentationActions}
      />

      <div className="flex flex-wrap items-start gap-3">
        <Avatar className="border-border size-12 border">
          <AvatarImage src={detail.photoUrl ?? undefined} alt={detail.fullName} />
          <AvatarFallback
            style={{ backgroundColor: accent.background, color: accent.foreground }}
            className="text-[13px] font-semibold"
          >
            {detail.initials}
          </AvatarFallback>
        </Avatar>
        <p className="pt-1 text-sm text-muted-foreground">{ageDobLine}</p>
      </div>

      <section aria-label="Care summary" className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-3 text-[14px] font-semibold text-foreground">Care summary</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Allergies</p>
            {allergies.state === "listed" ? (
              <StatusPill tone="danger" className="normal-case tracking-tight">
                {allergies.value}
              </StatusPill>
            ) : (
              <p className="text-[13px] font-medium text-foreground">{allergies.value}</p>
            )}
            <p className="mt-1 text-[12px] text-muted-foreground">{allergies.reviewLabel}</p>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Code status</p>
            <CodeStatusHeadline semantic={codeSemantic} headline={codeHeadline.headline} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Acuity</p>
            <AcuityInline acuity={detail.acuity} />
          </div>
        </div>

        <details className="mt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show directives and diagnoses
          </summary>
          <div className="space-y-4 pt-3">
            <div id="directives-anchor" className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-3 text-[13px]">
                <p className="text-[12px] font-semibold text-muted-foreground">Advance directives</p>
                <DirectiveRow label="Do not hospitalize" value={detail.advanceDirectiveOnFile ? "Captured on file" : "Not on file"} />
                <DirectiveRow label="POLST / MOLST" value={polstMolst} />
                <DirectiveRow label="Feeding tube" value={tubeHint} />
                <DirectiveRow
                  label="Hospice election"
                  value={
                    detail.hospiceStatus === "active" ? (
                      <StatusPill tone="danger" className="normal-case tracking-tight">
                        {hospiceElectionPhrase(detail.hospiceStatus)}
                      </StatusPill>
                    ) : (
                      hospiceElectionPhrase(detail.hospiceStatus ?? null)
                    )
                  }
                />
                <DirectiveRow
                  label="Diet order"
                  value={diagnosisDisplayTitle(detail.dietOrder ?? "") || "Not reviewed"}
                />
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground">Fall risk</p>
                  <ResidentFallRiskPresentation raw={detail.fallRiskRaw} />
                </div>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-muted-foreground">Diagnoses</p>
                {diagnosisPhrases.length ? (
                  <ul className="mt-2 space-y-1">
                    {diagnosisPhrases.map((phrase) => (
                      <li key={phrase} className="text-[13px] text-foreground">
                        {phrase}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-muted-foreground">No diagnoses documented</p>
                )}
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {detail.diagnosesReviewedAt
                    ? formatCodeStatusVerificationLabel(
                        detail.diagnosesReviewedAt,
                        detail.diagnosesReviewedByName,
                      ).label.replace(/^Verified /, "Reviewed ")
                    : "Review pending"}
                </p>
              </div>
            </div>
            <Link
              prefetch={false}
              href={hrefs.carePlanHref}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Open care plan
            </Link>
          </div>
        </details>
      </section>

      <div className="w-full shrink-0">
        <ResidentDetailTabStrip hrefs={hrefs} active="overview" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8" id="activity-timeline">
          <RecordDetailSection
            title="Recent activity"
            description={activityWindow.label}
          >
            {timelineEmpty ? (
              <p role="status" className="text-[13px] text-muted-foreground">
                {formatResidentOverviewActivityEmptyCopy(activityWindow)}
              </p>
            ) : (
              <div className="space-y-3">
                {feedItems.map((item, idx) => renderFeedItem(item, idx))}
              </div>
            )}
          </RecordDetailSection>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <RecordDetailSection title="Needs attention">
            {attentionItems.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{overviewAttentionEmptyCopy()}</p>
            ) : (
              <ul className="space-y-2">
                {attentionItems.map((task) => (
                  <li key={task.id} className="flex gap-2">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        task.tone === "danger" ? "bg-destructive" : "bg-warning",
                      )}
                    />
                    <div className="min-w-0">
                      {task.href ? (
                        <Link
                          prefetch={false}
                          href={task.href}
                          className="text-[13px] font-medium underline-offset-4 hover:underline"
                        >
                          {task.title}
                        </Link>
                      ) : (
                        <p className="text-[13px] font-medium">{task.title}</p>
                      )}
                      <p className="text-[12px] text-muted-foreground">{task.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </RecordDetailSection>

          <RecordDetailSection title="Care contacts">
            <div className="space-y-3 text-[13px]">
              <div>
                <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Primary care physician</p>
                <p className="font-medium">{detail.primaryPhysicianName ?? "Not on file"}</p>
                {detail.primaryPhysicianPhone ? (
                  <p className="text-[12px] text-muted-foreground">{detail.primaryPhysicianPhone}</p>
                ) : null}
              </div>
              <ContactBlock
                tier="Emergency contact"
                row={primaryContactRow}
                onOpen={() => primaryContactRow && setContactModal(primaryContactRow)}
              />
              {secondaryContactRow || poaPreferred ? (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    More contacts
                  </summary>
                  <div className="space-y-3 pt-2">
                    <ContactBlock
                      tier="Secondary"
                      row={secondaryContactRow}
                      onOpen={() => secondaryContactRow && setContactModal(secondaryContactRow)}
                    />
                    <ContactBlock
                      tier="POA / healthcare proxy"
                      row={poaPreferred}
                      onOpen={() => poaPreferred && setContactModal(poaPreferred)}
                    />
                  </div>
                </details>
              ) : null}
            </div>
            <span id="contacts" />
          </RecordDetailSection>

          <RecordDetailSection title="Record completeness">
            {completenessItems.length ? (
              <ul className="mb-3 space-y-1.5">
                {completenessItems.map((item) => (
                  <li key={item.id} className="text-[13px] text-muted-foreground">
                    {item.href ? (
                      <Link prefetch={false} href={item.href} className="underline-offset-4 hover:underline">
                        {item.label}
                      </Link>
                    ) : (
                      item.label
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-[13px] text-muted-foreground">No record gaps listed from this overview.</p>
            )}
            <ResidentIntakeLinks residentId={detail.id} compact />
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

function CodeStatusHeadline({
  semantic,
  headline,
}: {
  semantic: "neutral" | "attention" | "critical";
  headline: string;
}) {
  if (semantic === "attention") {
    return (
      <StatusPill tone="warning" className="normal-case tracking-tight">
        {headline}
      </StatusPill>
    );
  }
  if (semantic === "critical") {
    return (
      <StatusPill tone="danger" className="normal-case tracking-tight">
        {headline}
      </StatusPill>
    );
  }
  return <p className="text-[13px] font-medium leading-snug text-foreground">{headline}</p>;
}

function DirectiveRow(props: {
  label: string;
  value: React.ReactNode;
}) {
  const { label, value } = props;
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="text-[13px] font-medium">{value}</div>
    </div>
  );
}

function ContactBlock(props: {
  tier: string;
  row: ResidentContactRowView | null;
  onOpen: () => void;
}) {
  const { tier, row, onOpen } = props;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{tier}</p>
      {row ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 text-left text-[13px] font-medium leading-relaxed underline-offset-4 hover:underline"
        >
          {row.name}{" "}
          <span className="text-muted-foreground">({row.relationship ?? "Relation pending"})</span>
          <br />
          <span className="text-[11px] text-muted-foreground">
            {row.phone ?? "Phone pending"} · Last contact {formatOverviewDayLabel(row.updatedAt) ?? "pending"}
          </span>
        </button>
      ) : (
        <p className="text-[13px] text-muted-foreground">Not on file</p>
      )}
    </div>
  );
}

function renderFeedItem(
  item:
    | { type: "condition"; label: string; content: ConditionEventContent }
    | { type: "behavior"; label: string; content: BehaviorEventContent }
    | { type: "adl"; label: string; content: ADLEventContent }
    | { type: "note"; label: string; content: { id: string; snippet: string; loggedByLabel: string } },
  idx: number,
) {
  if (item.type === "condition") {
    const c = item.content;
    return (
      <div key={`cond-${c.id}-${idx}`} className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Stethoscope className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-destructive/20 bg-card p-3">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {c.typeLabel}{" "}
              <span className="ml-1 text-[11px] font-semibold text-destructive">
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
  if (item.type === "behavior") {
    const b = item.content;
    return (
      <div key={`beh-${b.id}-${idx}`} className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
          <Brain className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-warning/20 bg-card p-3">
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
  if (item.type === "note") {
    const note = item.content;
    return (
      <div key={`note-${note.id}-${idx}`} className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-3">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">Note</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{item.label}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">{note.snippet}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Logged by {note.loggedByLabel}</p>
        </div>
      </div>
    );
  }
  const a = item.content;
  return (
    <div key={`adl-${a.id}-${idx}`} className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <User className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-3">
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
