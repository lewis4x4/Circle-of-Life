"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import type { CatalogRow, IntakeCommand, IntakeItem } from "@/lib/document-intake/contracts";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import { cn } from "@/lib/utils";

import {
  abandonFiling,
  correctFiling,
  fileItem,
  IntakeRequestError,
  releaseOnLeave,
  sendCommand,
  splitItem,
  STALE_MESSAGE,
  type CommandPayload,
} from "./api";
import {
  intakeClient,
  loadCatalog,
  loadItemDetail,
  loadPeopleNames,
  loadReviewers,
  loadSettings,
  type IntakeSettings,
  type ItemDetail,
  type ReviewerOption,
} from "./data";
import { filingReadiness, groupCatalog, hasNoSafeDestination, initialCandidateIndex, type FilingDraft } from "./destination";
import { DestinationPicker } from "./DestinationPicker";
import { AssignDialog, ConfirmDialog, DuplicateDialog, FIELD_CLASS, ReasonDialog, SetFacilityDialog } from "./IntakeDialogs";
import { useCheckVerdicts } from "./JevVerdictControl";
import { CHANNEL_LABELS, itemTitle, pagesLabel, processingLabel, processingTone, REVIEWABLE_STATUSES, statusLabel, statusTone } from "./model";
import { VERDICTS_NEEDED_REASON, verdictsComplete, verdictsForFiling } from "./model";
import { AssessmentSection, FilingReceipt, HistorySection } from "./ReviewSections";
import { isPdf, SourcePreview, usePdfDocument } from "./SourcePreview";
import { SplitDialog } from "./SplitDialog";

type DialogName = "assign" | "hold" | "exclude" | "duplicate" | "split" | "reprocess" | "facility" | "correct" | null;

const EMPTY_DRAFT: FilingDraft = { title: "", catalogCode: "", subject: null, requirementId: null, documentDate: "", expirationDate: "" };

/** The starting draft: only what the document or its proposal evidenced. Nothing from today. */
export function draftFromDetail(detail: ItemDetail, catalog: readonly CatalogRow[]): FilingDraft {
  const { item, proposal } = detail;
  const code = proposal?.catalog_code && catalog.some((c) => c.code === proposal.catalog_code && c.active) ? proposal.catalog_code : "";
  const index = initialCandidateIndex(proposal);
  const candidate = index == null ? null : proposal!.candidates[index];
  const row = catalog.find((c) => c.code === code) ?? null;
  const subject = candidate && row && candidate.kind === row.destination_kind ? { subject_id: candidate.subject_id!, label: candidate.label, requirement_id: candidate.requirement_id ?? null } : null;
  return {
    title: item.display_title ?? proposal?.suggested_title ?? "",
    catalogCode: code,
    subject,
    requirementId: subject?.requirement_id ?? null,
    documentDate: proposal?.document_date ?? "",
    expirationDate: "",
  };
}

function draftsDiffer(a: FilingDraft, b: FilingDraft): boolean {
  return (
    a.title !== b.title ||
    a.catalogCode !== b.catalogCode ||
    a.subject?.subject_id !== b.subject?.subject_id ||
    a.requirementId !== b.requirementId ||
    a.documentDate !== b.documentDate ||
    a.expirationDate !== b.expirationDate
  );
}

export function DocumentIntakeReview({ itemId }: { itemId: string }) {
  const ids = { title: useId(), type: useId(), docDate: useId(), expDate: useId() };
  const { user, appRole } = useHavenAuth();
  const userId = user?.id ?? null;
  const facilities = useFacilityStore((s) => s.availableFacilities);

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; forbidden: boolean } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [settings, setSettings] = useState<IntakeSettings | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([]);

  const [draft, setDraft] = useState<FilingDraft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<FilingDraft>(EMPTY_DRAFT);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [requirementRequired, setRequirementRequired] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [view, setView] = useState<"source" | "details">("details");
  const [pdfReload, setPdfReload] = useState(0);
  const [filed, setFiled] = useState<{ href: string } | null>(null);
  const [fileRetry, setFileRetry] = useState(false);
  const [verdicts, setVerdict] = useCheckVerdicts(detail?.proposal?.id ?? null);

  /** One request key per user action, kept only while that action may be retried as-is. */
  const keys = useRef(new Map<string, string>());
  const keyFor = (action: string) => {
    const existing = keys.current.get(action);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    keys.current.set(action, fresh);
    return fresh;
  };
  const claimedRef = useRef<Pick<IntakeItem, "id" | "revision"> | null>(null);
  const claimAttempted = useRef(false);

  const pdf = usePdfDocument(detail?.item ?? null, pdfReload);

  const load = useCallback(async () => {
    try {
      const sb = intakeClient();
      const next = await loadItemDetail(sb, itemId);
      if (!next) {
        setNotFound(true);
        setDetail(null);
        return null;
      }
      setDetail(next);
      setLoadError(null);
      if (claimedRef.current) claimedRef.current = { id: next.item.id, revision: next.item.revision };
      const people = await loadPeopleNames(sb, [
        next.item.assigned_to,
        next.item.claimed_by,
        ...next.events.map((e) => e.actor_id),
        ...next.filings.flatMap((f) => [f.approved_by, f.corrected_by]),
      ]);
      setNames((prior) => ({ ...prior, ...people }));
      return next;
    } catch (cause) {
      const forbidden = !!(cause && typeof cause === "object" && "forbidden" in cause && (cause as { forbidden: boolean }).forbidden);
      setLoadError({ message: cause instanceof Error ? cause.message : "This document could not be loaded.", forbidden });
      return null;
    }
  }, [itemId]);

  useEffect(() => {
    const sb = intakeClient();
    void load();
    void loadCatalog(sb).then(setCatalog).catch(() => setCatalog([]));
    void loadSettings(sb).then(setSettings);
  }, [load]);

  const loaded = detail != null;
  const reviewerFacilityId = detail?.item.facility_id ?? null;
  useEffect(() => {
    if (!loaded) return;
    void loadReviewers(intakeClient(), reviewerFacilityId).then(setReviewers);
  }, [loaded, reviewerFacilityId]);

  const dirty = draftsDiffer(draft, baseline);

  // Start (or restart, when a new proposal arrives and nothing was edited) from the evidence.
  useEffect(() => {
    if (!detail || catalog.length === 0) return;
    const key = `${detail.item.id}:${detail.proposal?.id ?? "none"}`;
    if (draftFor === key) return;
    const next = draftFromDetail(detail, catalog);
    if (draftFor !== null && dirty) {
      setNotice("A new suggestion arrived. Your edits are kept; compare them with the assessment.");
      setBaseline(next);
    } else {
      setDraft(next);
      setBaseline(next);
    }
    setDraftFor(key);
  }, [detail, catalog, draftFor, dirty]);

  // Claim on open; release on leave.
  useEffect(() => {
    if (!detail || !userId || claimAttempted.current) return;
    const { item } = detail;
    if (!REVIEWABLE_STATUSES.includes(item.status)) return;
    claimAttempted.current = true;
    const heldByOther = item.claimed_by && item.claimed_by !== userId && item.claim_expires_at && Date.parse(item.claim_expires_at) > Date.now();
    if (heldByOther) return;
    void sendCommand(item, "claim", {}, crypto.randomUUID())
      .then(({ item: claimed }) => {
        claimedRef.current = { id: claimed.id, revision: claimed.revision };
        setDetail((d) => (d ? { ...d, item: claimed } : d));
      })
      .catch(async (cause) => {
        if (cause instanceof IntakeRequestError && cause.isStale) await load();
      });
  }, [detail, userId, load]);

  useEffect(() => {
    const onHide = () => {
      if (claimedRef.current) releaseOnLeave(claimedRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
      claimedRef.current = null;
    };
  }, []);

  // Warn before leaving with unsaved edits (browser close/reload and in-app links).
  const filedNow = detail?.item.status === "filed" || !!filed;
  useEffect(() => {
    if (!dirty || filedNow) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("/api/")) return;
      if (!window.confirm("You have unsaved changes to this document. Leave without filing?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, filedNow]);

  const catalogRow = useMemo(() => catalog.find((c) => c.code === draft.catalogCode) ?? null, [catalog, draft.catalogCode]);
  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const onRequirementRequired = useCallback((required: boolean) => setRequirementRequired(required), []);

  /** Runs one write; returns an error line for the dialog or null. */
  async function act(action: string, run: (key: string) => Promise<{ item?: IntakeItem } | unknown>): Promise<string | null> {
    setBusy(action);
    setActionError(null);
    try {
      const result = (await run(keyFor(action))) as { item?: IntakeItem } | undefined;
      keys.current.delete(action);
      if (result?.item) {
        const updated = result.item;
        if (claimedRef.current && updated.id === claimedRef.current.id) claimedRef.current = { id: updated.id, revision: updated.revision };
        setDetail((d) => (d ? { ...d, item: updated } : d));
      }
      await load();
      setDialog(null);
      return null;
    } catch (cause) {
      if (cause instanceof IntakeRequestError) {
        if (!cause.isRetryable) keys.current.delete(action);
        if (cause.isStale) {
          await load();
          setNotice(STALE_MESSAGE);
          return STALE_MESSAGE;
        }
        return cause.message;
      }
      keys.current.delete(action);
      return "The request did not complete. Try again.";
    } finally {
      setBusy(null);
    }
  }

  const command = (name: IntakeCommand, payload: CommandPayload = {}) => act(name, (key) => sendCommand(detail!.item, name, payload, key));

  async function approve() {
    if (!detail || !catalogRow) return;
    setBusy("file");
    setActionError(null);
    setFileRetry(false);
    try {
      const result = await fileItem(
        detail.item,
        {
          catalog_code: catalogRow.code,
          subject_id: catalogRow.subject_kind === "facility" ? detail.item.facility_id : (draft.subject?.subject_id ?? null),
          requirement_id: catalogRow.destination_kind === "employee_file" ? draft.requirementId : null,
          title: draft.title.trim(),
          document_date: draft.documentDate || null,
          expiration_date: draft.expirationDate || null,
          check_verdicts: verdictsForFiling(detail.proposal, verdicts),
        },
        keyFor("file"),
      );
      keys.current.delete("file");
      claimedRef.current = null;
      setFiled({ href: result.href });
      setBaseline(draft);
      await load();
    } catch (cause) {
      if (cause instanceof IntakeRequestError && cause.isRetryable) {
        // Keep the key: "Try again" replays this exact filing.
        setFileRetry(true);
        setActionError("Filing did not finish. Try again; it will not file twice.");
        if (cause.filingId) await load();
      } else if (cause instanceof IntakeRequestError && cause.isStale) {
        keys.current.delete("file");
        await load();
        setNotice(STALE_MESSAGE);
      } else {
        keys.current.delete("file");
        setActionError(cause instanceof Error ? cause.message : "Filing did not finish.");
        // A filing that was prepared but not completed shows with a cancel button after reload.
        if (cause instanceof IntakeRequestError && cause.filingId) await load();
      }
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="flex max-w-[1440px] flex-col gap-4 pt-2">
        <RecordDetailHeader title="Document" backLink={{ label: "Document Intake", href: "/admin/document-intake" }} />
        {loadError.forbidden ? (
          <AdminEmptyState title="You can’t review this document" description="Your role or facility access does not include it." />
        ) : (
          <AdminErrorState message={loadError.message} onRetry={() => void load()} />
        )}
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="flex max-w-[1440px] flex-col gap-4 pt-2">
        <RecordDetailHeader title="Document not found" backLink={{ label: "Document Intake", href: "/admin/document-intake" }} />
        <AdminEmptyState title="This document is not available" description="It may belong to a facility you cannot see, or it was split into parts." />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex max-w-[1440px] flex-col gap-4 pt-2" role="status" aria-label="Loading document">
        <AdminTableLoadingState />
      </div>
    );
  }

  const { item, proposal } = detail;
  const facilityName = item.facility_id ? (facilities.find((f) => f.id === item.facility_id)?.name ?? "This facility") : "Facility unknown";
  const reviewable = REVIEWABLE_STATUSES.includes(item.status) && !filed;
  const liveFiling = detail.filings.find((f) => f.state === "filed" || f.state === "corrected") ?? null;
  const stuckFiling = detail.filings.find((f) => f.state === "preparing" || f.state === "attested") ?? null;
  const claimedByOther = !!item.claimed_by && item.claimed_by !== userId && !!item.claim_expires_at && Date.parse(item.claim_expires_at) > Date.now();
  const custodian = (settings?.custodian_roles ?? ["owner", "org_admin"]).includes(appRole);
  const readiness = filingReadiness(draft, catalogRow, { requirementRequired, facilityKnown: !!item.facility_id });
  const blockedReason = !readiness.ready ? readiness.reason : verdictsComplete(proposal, verdicts) ? null : VERDICTS_NEEDED_REASON;
  const summaryPages = pagesLabel(proposal?.summary_pages);
  const pageCount = pdf.doc?.numPages ?? item.page_count ?? 0;
  const canSplit = reviewable && isPdf(item) && pageCount > 1;
  const typeLabel = (code: string) => catalog.find((c) => c.code === code)?.label ?? "Type not listed";

  const details = (
    <div className="flex flex-col gap-4">
      {liveFiling ? (
        <FilingReceipt
          filing={liveFiling}
          href={filed?.href ?? null}
          typeLabel={typeLabel(liveFiling.catalog_code)}
          names={names}
          onCorrect={liveFiling.state === "filed" ? () => setDialog("correct") : null}
        />
      ) : null}

      {stuckFiling && !liveFiling ? (
        <RecordDetailSection title="Filing did not finish" description="A filing was started but not completed. Cancel it to file again.">
          <Button
            type="button"
            variant="outline"
            disabled={!!busy}
            onClick={async () => {
              const error = await act("abandon", (key) => abandonFiling(stuckFiling.id, key));
              if (error) setActionError(error);
            }}
          >
            Cancel the unfinished filing
          </Button>
        </RecordDetailSection>
      ) : null}

      {item.status === "split" ? (
        <RecordDetailSection title="Split into parts" description="Each part is its own document now.">
          <ul className="grid gap-1 text-sm">
            {detail.children.map((child) => (
              <li key={child.id}>
                <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`/admin/document-intake/${child.id}`}>
                  {itemTitle(child)}
                </Link>{" "}
                <span className="text-muted-foreground">{pagesLabel(child.parent_pages)}</span>
              </li>
            ))}
          </ul>
        </RecordDetailSection>
      ) : null}

      <RecordDetailSection title="Document">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <FormLabel htmlFor={ids.title} required={reviewable}>
              Title
            </FormLabel>
            <div className="flex gap-2">
              <Input
                id={ids.title}
                value={draft.title}
                maxLength={200}
                disabled={!reviewable}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              {reviewable && draft.title.trim() && draft.title.trim() !== (item.display_title ?? "") ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy}
                  onClick={async () => {
                    const error = await command("set_title", { title: draft.title.trim() });
                    if (error) setActionError(error);
                  }}
                >
                  Save title
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Original file name: <span className="break-all text-foreground">{item.original_filename}</span>
            </p>
          </div>

          <div className="grid gap-1 text-sm">
            <h3 className="text-xs font-semibold text-muted-foreground">Summary</h3>
            {proposal?.summary ? (
              <p className="text-foreground">
                {proposal.summary}
                {summaryPages ? <span className="text-muted-foreground"> ({summaryPages})</span> : null}
              </p>
            ) : (
              <p className="text-muted-foreground">No summary. Read the original.</p>
            )}
          </div>

          <div className="grid gap-1">
            <FormLabel htmlFor={ids.type} required={reviewable}>
              Document type
            </FormLabel>
            <select
              id={ids.type}
              className={FIELD_CLASS}
              value={draft.catalogCode}
              disabled={!reviewable}
              onChange={(e) => setDraft((d) => ({ ...d, catalogCode: e.target.value, subject: null, requirementId: null }))}
            >
              <option value="">Choose a type</option>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.rows.map((row) => (
                    <option key={row.code} value={row.code}>
                      {row.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {catalogRow && !catalogRow.reviewer_roles.includes(appRole) ? <p className="text-sm text-foreground">You can’t file this type. Assign it to someone who can.</p> : null}
          </div>
        </div>
      </RecordDetailSection>

      {reviewable ? (
        <RecordDetailSection title="Where it files">
          {hasNoSafeDestination(proposal) && !draft.subject ? (
            <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
              No safe destination: the reader could not tell who or what this is about. Pick one, or leave it for someone who knows.
            </p>
          ) : null}
          {proposal && !draft.subject && initialCandidateIndex(proposal) == null && proposal.proposed_candidate != null && !hasNoSafeDestination(proposal) ? (
            <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
              More than one suggestion has the same name. Pick the right one yourself.
            </p>
          ) : null}
          <DestinationPicker
            catalog={catalogRow}
            facilityId={item.facility_id}
            facilityName={facilityName}
            candidates={proposal?.candidates ?? []}
            subject={draft.subject}
            onSubjectChange={(subject) => setDraft((d) => ({ ...d, subject, requirementId: subject?.requirement_id ?? d.requirementId }))}
            requirementId={draft.requirementId}
            onRequirementChange={(requirementId) => setDraft((d) => ({ ...d, requirementId }))}
            onRequirementRequired={onRequirementRequired}
            disabled={!!busy}
          />
          {draft.subject ? <p className="mt-2 text-sm text-foreground">Selected: <span className="font-medium">{draft.subject.label}</span></p> : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <FormLabel htmlFor={ids.docDate}>Document date</FormLabel>
              <Input id={ids.docDate} type="date" value={draft.documentDate} onChange={(e) => setDraft((d) => ({ ...d, documentDate: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <FormLabel htmlFor={ids.expDate}>Expiration date</FormLabel>
              <Input id={ids.expDate} type="date" value={draft.expirationDate} onChange={(e) => setDraft((d) => ({ ...d, expirationDate: e.target.value }))} />
            </div>
          </div>
        </RecordDetailSection>
      ) : null}

      <AssessmentSection item={item} proposal={proposal} verdicts={verdicts} onVerdictChange={reviewable && !claimedByOther ? setVerdict : undefined} />

      {reviewable || item.status === "excluded" || item.status === "duplicate" ? (
        <RecordDetailSection title="Actions">
          {claimedByOther ? (
            <p className="mb-3 text-sm text-foreground">{names[item.claimed_by!] ?? "Someone else"} is reviewing this document right now.</p>
          ) : null}
          {actionError ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          {reviewable ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={!!blockedReason || !!busy || claimedByOther} onClick={() => void approve()}>
                  {busy === "file" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {fileRetry ? "Try again" : "Approve filing"}
                </Button>
                {blockedReason ? <span className="text-sm text-muted-foreground">{blockedReason}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => setDialog("assign")}>
                  Assign
                </Button>
                {item.status === "held" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!!busy}
                    onClick={async () => {
                      const error = await command("resume");
                      if (error) setActionError(error);
                    }}
                  >
                    Take off hold
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={!!busy} onClick={() => setDialog("hold")}>
                    Hold
                  </Button>
                )}
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => setDialog("exclude")}>
                  Exclude
                </Button>
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => setDialog("duplicate")}>
                  Mark duplicate
                </Button>
                {canSplit ? (
                  <Button type="button" variant="outline" disabled={!!busy || pdf.status !== "ready"} onClick={() => setDialog("split")}>
                    Split pages
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy || item.processing_state === "queued" || item.processing_state === "running"}
                  onClick={async () => {
                    if (item.processing_state === "uncertain") {
                      setDialog("reprocess");
                      return;
                    }
                    const error = await command("reprocess");
                    if (error) setActionError(error);
                  }}
                >
                  Read again
                </Button>
                {custodian && !item.facility_id ? (
                  <Button type="button" variant="outline" disabled={!!busy} onClick={() => setDialog("facility")}>
                    Set facility
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              {item.status === "excluded" ? `Excluded: ${item.exclude_reason ?? "no reason recorded"}.` : null}
              {item.status === "duplicate" && item.duplicate_of ? (
                <>
                  Duplicate of{" "}
                  <Link className="underline underline-offset-4" href={`/admin/document-intake/${item.duplicate_of}`}>
                    another document
                  </Link>
                  .
                </>
              ) : null}
            </p>
          )}
        </RecordDetailSection>
      ) : null}

      <HistorySection events={detail.events} names={names} />
    </div>
  );

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-8 pt-2">
      <RecordDetailHeader
        title={itemTitle(item)}
        subtitle={`${facilityName} · ${CHANNEL_LABELS[item.channel]} · Received ${formatFacilityTimestampEt(item.received_at)} ET${item.sender_address ? ` · From ${item.sender_address}${item.sender_authenticated ? "" : " (not verified)"}` : ""}`}
        backLink={{ label: "Document Intake", href: "/admin/document-intake" }}
        statusChips={
          <>
            <StatusPill tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusPill>
            <StatusPill tone={processingTone(item.processing_state)} dot={false}>
              {processingLabel(item.processing_state)}
            </StatusPill>
            {item.assigned_to ? <StatusPill tone="muted" dot={false}>{`Assigned to ${item.assigned_to === userId ? "me" : (names[item.assigned_to] ?? "a reviewer")}`}</StatusPill> : null}
          </>
        }
      />

      {notice ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="flex-1">{notice}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {item.hold_reason && item.status === "held" ? <p className="text-sm text-foreground">On hold: {item.hold_reason}</p> : null}
      {item.attention_reason && item.status === "needs_attention" ? <p className="text-sm text-foreground">Needs attention: {item.attention_reason}</p> : null}

      <div role="group" aria-label="Show" className="flex gap-1 rounded-lg bg-muted/40 p-1 lg:hidden">
        {(["source", "details"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={cn(
              "min-h-11 flex-1 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {key === "source" ? "Source" : "Details"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Both panes stay mounted so switching on a tablet keeps unsaved edits. */}
        <div className={cn("min-w-0 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto", view === "source" ? "block" : "hidden")}>
          <SourcePreview item={item} pdf={pdf} onRetry={() => setPdfReload((n) => n + 1)} />
        </div>
        <div className={cn("min-w-0 lg:block", view === "details" ? "block" : "hidden")}>{details}</div>
      </div>

      <AssignDialog
        open={dialog === "assign"}
        onOpenChange={(open) => setDialog(open ? "assign" : null)}
        reviewers={reviewers}
        currentUserId={userId}
        assignedTo={item.assigned_to}
        onSubmit={(user_id) => command("assign", { user_id })}
      />
      <ReasonDialog
        open={dialog === "hold"}
        onOpenChange={(open) => setDialog(open ? "hold" : null)}
        title="Put on hold"
        description="The document stays in Pending review with your reason until someone takes it off hold."
        label="Why is it on hold?"
        confirm="Hold"
        onSubmit={(reason) => command("hold", { reason })}
      />
      <ReasonDialog
        open={dialog === "exclude"}
        onOpenChange={(open) => setDialog(open ? "exclude" : null)}
        title="Exclude this document"
        description="It leaves the queue and is not filed. The original and this reason are kept."
        label="Why is it excluded?"
        confirm="Exclude"
        destructive
        onSubmit={(reason) => command("exclude", { reason })}
      />
      <DuplicateDialog
        open={dialog === "duplicate"}
        onOpenChange={(open) => setDialog(open ? "duplicate" : null)}
        item={item}
        onSubmit={(duplicate_of) => command("mark_duplicate", { duplicate_of })}
      />
      <ConfirmDialog
        open={dialog === "reprocess"}
        onOpenChange={(open) => setDialog(open ? "reprocess" : null)}
        title="Send it again?"
        description="The last AI request may already have been charged. Send it again?"
        confirm="Send again"
        onConfirm={() => command("reprocess", { accept_possible_duplicate_charge: true })}
      />
      <SetFacilityDialog open={dialog === "facility"} onOpenChange={(open) => setDialog(open ? "facility" : null)} facilities={facilities} onSubmit={(facility_id) => command("set_facility", { facility_id })} />
      {canSplit ? (
        <SplitDialog
          open={dialog === "split"}
          onOpenChange={(open) => setDialog(open ? "split" : null)}
          pdf={pdf}
          pageCount={pageCount}
          segments={proposal?.segments ?? []}
          onSubmit={(plan) => act("split", (key) => splitItem(item, plan, key))}
        />
      ) : null}
      {liveFiling ? (
        <ReasonDialog
          open={dialog === "correct"}
          onOpenChange={(open) => setDialog(open ? "correct" : null)}
          title="Correct this filing"
          description="Use this when the document was filed to the wrong place or with the wrong details. The filing is marked as a mistake and the history keeps both."
          label="What was wrong?"
          confirm="Correct filing"
          destructive
          onSubmit={(reason) => act("correct", (key) => correctFiling(liveFiling.id, reason, key))}
        />
      ) : null}
    </div>
  );
}
