"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, FileWarning, Loader2, NotebookPen, UserRoundX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { DocumentAuditEventRow, DocumentRow } from "../lib/types";
import { adminUpdateDocument, createObsidianDraft } from "../lib/knowledge-api";

type DoctrineReviewQueueProps = {
  documents: DocumentRow[];
  onRefresh: () => void;
};

type StuckBucket = "missing_draft" | "missing_reviewer" | "overdue";
type SlaFilter = "all" | "due_soon" | "overdue";

function dueDateLabel(value: string | null): string {
  if (!value) return "No due date";
  return `Due ${new Date(value).toLocaleDateString()}`;
}

function isDueSoon(value: string | null, today: Date): boolean {
  if (!value) return false;
  const due = new Date(value);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays <= 3;
}

function latestAuditEventAt(events: DocumentAuditEventRow[], documentId: string, eventType: string): string | null {
  const match = events.find((event) => event.document_id === documentId && event.event_type === eventType);
  return match?.created_at ?? null;
}

export function DoctrineReviewQueue({ documents, onRefresh }: DoctrineReviewQueueProps) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useHavenAuth();
  const [auditEvents, setAuditEvents] = useState<DocumentAuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("all");
  const [activeSectionHash, setActiveSectionHash] = useState("");

  useEffect(() => {
    const syncHash = () => setActiveSectionHash(window.location.hash || "");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const loadAudit = useCallback(async () => {
    const docIds = documents.map((doc) => doc.id);
    if (docIds.length === 0) {
      setAuditEvents([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("document_audit_events")
        .select("*")
        .in("document_id", docIds)
        .in("event_type", ["obsidian_draft_created", "review_completed"])
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      setAuditEvents((data ?? []) as DocumentAuditEventRow[]);
    } catch (loadError) {
      setAuditEvents([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load doctrine review queue.");
    } finally {
      setLoading(false);
    }
  }, [documents, supabase]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const draftCreatedIds = useMemo(
    () => new Set(auditEvents.filter((event) => event.event_type === "obsidian_draft_created").map((event) => event.document_id)),
    [auditEvents],
  );

  const reviewCompletedIds = useMemo(
    () =>
      new Set(
        documents
          .filter((doc) => {
            const lastDraftAt = latestAuditEventAt(auditEvents, doc.id, "obsidian_draft_created");
            const lastReviewCompletedAt = latestAuditEventAt(auditEvents, doc.id, "review_completed");
            if (!lastReviewCompletedAt) return false;
            if (!lastDraftAt) return true;
            return new Date(lastReviewCompletedAt).getTime() >= new Date(lastDraftAt).getTime();
          })
          .map((doc) => doc.id),
      ),
    [auditEvents, documents],
  );

  const today = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, []);

  const buckets = useMemo(() => {
    const pendingDocs = documents.filter((doc) => doc.status === "pending_review");
    const missingDraft = pendingDocs.filter((doc) => !draftCreatedIds.has(doc.id));
    const missingReviewer = pendingDocs.filter((doc) => !doc.review_owner);
    const overdue = pendingDocs.filter((doc) => {
      if (!doc.review_due_at) return false;
      const due = new Date(doc.review_due_at);
      due.setHours(0, 0, 0, 0);
      return due < today;
    });
    return { missingDraft, missingReviewer, overdue };
  }, [documents, draftCreatedIds, today]);

  const doctrineMetrics = useMemo(() => {
    const pendingDocs = documents.filter((doc) => doc.status === "pending_review");
    const readyDocs = pendingDocs.filter(
      (doc) => !!doc.review_owner && !!doc.review_due_at && draftCreatedIds.has(doc.id) && reviewCompletedIds.has(doc.id),
    );
    const readyToPublish = readyDocs.length;
    const blockedPending = pendingDocs.length - readyToPublish;
    const dueSoon = pendingDocs.filter((doc) => isDueSoon(doc.review_due_at, today)).length;
    const reviewedThisWeek = auditEvents.filter((event) => {
      if (event.event_type !== "review_completed") return false;
      const createdAt = new Date(event.created_at);
      return createdAt.getTime() >= Date.now() - 7 * 86_400_000;
    }).length;
    return {
      pendingDocs,
      readyDocs,
      readyToPublish,
      blockedPending,
      dueSoon,
      reviewedThisWeek,
    };
  }, [auditEvents, documents, draftCreatedIds, reviewCompletedIds, today]);

  const reviewSlaRows = useMemo(() => {
    return doctrineMetrics.pendingDocs
      .map((doc) => {
        if (!doc.review_due_at) return null;
        const due = new Date(doc.review_due_at);
        due.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
        const status: "due_soon" | "overdue" | "future" =
          diffDays < 0 ? "overdue" : diffDays <= 3 ? "due_soon" : "future";
        return {
          doc,
          diffDays,
          status,
        };
      })
      .filter((item): item is { doc: DocumentRow; diffDays: number; status: "due_soon" | "overdue" | "future" } => Boolean(item))
      .filter((item) => item.status !== "future")
      .sort((a, b) => a.diffDays - b.diffDays);
  }, [doctrineMetrics.pendingDocs, today]);

  const visibleSlaRows = reviewSlaRows.filter((item) => {
    if (slaFilter === "all") return true;
    return item.status === slaFilter;
  });

  const publishBlockers = useMemo(() => {
    return doctrineMetrics.pendingDocs
      .map((doc) => {
        const blockers: string[] = [];
        if (!doc.review_owner) blockers.push("no reviewer");
        if (!doc.review_due_at) blockers.push("no due date");
        if (!draftCreatedIds.has(doc.id)) blockers.push("no draft");
        if (!reviewCompletedIds.has(doc.id)) blockers.push("review not completed");
        return { doc, blockers };
      })
      .filter((item) => item.blockers.length > 0)
      .slice(0, 4);
  }, [doctrineMetrics.pendingDocs, draftCreatedIds, reviewCompletedIds]);

  const runPublish = useCallback(async (documentId: string) => {
    setActionLoading(documentId);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await adminUpdateDocument(documentId, { status: "published" });
      if (!result.ok) throw new Error(result.error);
      setActionMessage("Document published to Grace.");
      await onRefresh();
      await loadAudit();
    } catch (publishError) {
      setActionError(publishError instanceof Error ? publishError.message : "Could not publish document.");
    } finally {
      setActionLoading(null);
    }
  }, [loadAudit, onRefresh]);

  const runPublishBulk = useCallback(async (documentIds: string[]) => {
    if (documentIds.length === 0) return;
    setActionLoading(`bulk-publish:${documentIds.length}`);
    setActionError(null);
    setActionMessage(null);
    try {
      for (const documentId of documentIds) {
        const result = await adminUpdateDocument(documentId, { status: "published" });
        if (!result.ok) throw new Error(result.error);
      }
      setActionMessage(`Published ${documentIds.length} document${documentIds.length === 1 ? "" : "s"} to Grace.`);
      await onRefresh();
      await loadAudit();
    } catch (publishError) {
      setActionError(publishError instanceof Error ? publishError.message : "Could not publish documents.");
    } finally {
      setActionLoading(null);
    }
  }, [loadAudit, onRefresh]);

  const runCreateDraft = useCallback(async (documentId: string) => {
    setActionLoading(documentId);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await createObsidianDraft(documentId);
      if (!result.ok) throw new Error(result.error);
      const payload = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
      const message =
        payload && typeof payload.message === "string"
          ? payload.message
          : payload && typeof payload.notePath === "string"
            ? `Obsidian draft created at ${payload.notePath}`
            : "Obsidian draft created.";
      setActionMessage(message);
      await onRefresh();
      await loadAudit();
    } catch (draftError) {
      setActionError(draftError instanceof Error ? draftError.message : "Could not create draft.");
    } finally {
      setActionLoading(null);
    }
  }, [loadAudit, onRefresh]);

  const runCreateDraftBulk = useCallback(async (documentIds: string[]) => {
    if (documentIds.length === 0) return;
    setActionLoading(`bulk-draft:${documentIds.length}`);
    setActionError(null);
    setActionMessage(null);
    try {
      let created = 0;
      let skipped = 0;
      for (const documentId of documentIds) {
        const result = await createObsidianDraft(documentId);
        if (!result.ok) throw new Error(result.error);
        const payload = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
        if (payload?.skipped === true) skipped += 1;
        else created += 1;
      }
      setActionMessage(
        skipped > 0
          ? `Draft pass finished: ${created} created, ${skipped} skipped because the vault was unavailable in this runtime.`
          : `Created ${created} Obsidian draft${created === 1 ? "" : "s"}.`,
      );
      await onRefresh();
      await loadAudit();
    } catch (draftError) {
      setActionError(draftError instanceof Error ? draftError.message : "Could not create drafts.");
    } finally {
      setActionLoading(null);
    }
  }, [loadAudit, onRefresh]);

  const assignToMe = useCallback(async (documentId: string) => {
    if (!user) return;
    setActionLoading(documentId);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await adminUpdateDocument(documentId, { review_owner: user.id });
      if (!result.ok) throw new Error(result.error);
      setActionMessage("Review owner set to you.");
      await onRefresh();
    } catch (assignError) {
      setActionError(assignError instanceof Error ? assignError.message : "Could not assign review owner.");
    } finally {
      setActionLoading(null);
    }
  }, [onRefresh, user]);

  const assignToMeBulk = useCallback(async (documentIds: string[]) => {
    if (!user || documentIds.length === 0) return;
    setActionLoading(`bulk-assign:${documentIds.length}`);
    setActionError(null);
    setActionMessage(null);
    try {
      for (const documentId of documentIds) {
        const result = await adminUpdateDocument(documentId, { review_owner: user.id });
        if (!result.ok) throw new Error(result.error);
      }
      setActionMessage(`Assigned ${documentIds.length} document${documentIds.length === 1 ? "" : "s"} to you.`);
      await onRefresh();
    } catch (assignError) {
      setActionError(assignError instanceof Error ? assignError.message : "Could not assign reviewers.");
    } finally {
      setActionLoading(null);
    }
  }, [onRefresh, user]);

  const sections: Array<{
    key: StuckBucket;
    title: string;
    icon: typeof NotebookPen;
    tone: string;
    items: DocumentRow[];
    actionLabel: string;
    action: (documentId: string) => Promise<void>;
    bulkActionLabel?: string;
    bulkAction?: (documentIds: string[]) => Promise<void>;
  }> = [
    {
      key: "missing_draft",
      title: "No Obsidian draft yet",
      icon: NotebookPen,
      tone: "text-info",
      items: buckets.missingDraft,
      actionLabel: "Create draft",
      action: runCreateDraft,
      bulkActionLabel: "Create all drafts",
      bulkAction: runCreateDraftBulk,
    },
    {
      key: "missing_reviewer",
      title: "No reviewer assigned",
      icon: UserRoundX,
      tone: "text-warning",
      items: buckets.missingReviewer,
      actionLabel: "Assign to me",
      action: assignToMe,
      bulkActionLabel: "Assign all to me",
      bulkAction: assignToMeBulk,
    },
    {
      key: "overdue",
      title: "Review overdue",
      icon: CalendarClock,
      tone: "text-destructive",
      items: buckets.overdue,
      actionLabel: "Open review",
      action: async () => {},
    },
  ];

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {actionMessage}
        </div>
      )}
      {activeSectionHash ? (
        <div className="rounded-[var(--radius)] border border-info/30 bg-info/10 px-3 py-2 text-sm text-info flex items-center justify-between gap-3">
          <span>
            Focused section:{" "}
            <span className="font-medium">
              {activeSectionHash === "#doctrine-blocked-review"
                ? "Blocked review"
                : activeSectionHash === "#doctrine-ready-to-publish"
                  ? "Ready to publish"
                  : activeSectionHash === "#doctrine-review-sla"
                    ? "Review SLA"
                    : activeSectionHash.replace(/^#/, "")}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full border border-border bg-card text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
              {activeSectionHash === "#doctrine-blocked-review"
                ? doctrineMetrics.blockedPending
                : activeSectionHash === "#doctrine-ready-to-publish"
                  ? doctrineMetrics.readyToPublish
                  : reviewSlaRows.length} visible
            </span>
            <Link
              href="/admin/knowledge/admin"
              className="rounded-[var(--radius)] px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Clear section focus
            </Link>
          </div>
        </div>
      ) : null}
      <div id="doctrine-blocked-review" className="rounded-[var(--radius)] border border-border bg-card p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Pending review", value: doctrineMetrics.pendingDocs.length },
            { label: "Ready to publish", value: doctrineMetrics.readyToPublish },
            { label: "Blocked in review", value: doctrineMetrics.blockedPending },
            { label: "Due soon / reviewed 7d", value: `${doctrineMetrics.dueSoon} / ${doctrineMetrics.reviewedThisWeek}` },
          ].map((metric) => (
            <div key={metric.label} className="rounded-[var(--radius)] border border-border p-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{metric.label}</div>
              <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{metric.value}</div>
            </div>
          ))}
        </div>

        {publishBlockers.length > 0 ? (
          <div className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-warning">Top promotion blockers</h4>
              <p className="text-xs text-warning">These pending-review docs still have missing prerequisites.</p>
            </div>
            <div className="space-y-2">
              {publishBlockers.map(({ doc, blockers }) => (
                <Link
                  key={doc.id}
                  href={`/admin/knowledge/admin/review/${doc.id}`}
                  className="flex items-center justify-between gap-3 min-h-[36px] rounded-[9px] border border-border bg-card px-[13px] py-2 text-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                >
                  <span className="font-medium text-foreground">{doc.title}</span>
                  <span className="text-xs text-warning">{blockers.join(" · ")}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

          <div className="flex items-center gap-2">
          <FileWarning className="h-5 w-5 text-warning" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Stuck Uploads</h3>
            <p className="text-xs text-muted-foreground">
              Uploaded documents that entered review but still need doctrine workflow actions.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-4 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading review backlog…
          </div>
        ) : error ? (
          <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.key} className="rounded-[var(--radius)] border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${section.tone}`} />
                      <div className="text-sm font-medium text-foreground">{section.title}</div>
                    </div>
                    <div className="text-sm font-semibold text-foreground tabular-nums">{section.items.length}</div>
                  </div>
                  {section.items.length > 1 && section.bulkAction && section.bulkActionLabel ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === `bulk-${section.key}:${section.items.length}` || actionLoading === `bulk-draft:${section.items.length}` || actionLoading === `bulk-assign:${section.items.length}`}
                      onClick={() => void section.bulkAction?.(section.items.map((doc) => doc.id))}
                    >
                      {actionLoading === `bulk-draft:${section.items.length}` || actionLoading === `bulk-assign:${section.items.length}`
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : section.bulkActionLabel}
                    </Button>
                  ) : null}
                  {section.items.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Nothing stuck here right now.</div>
                  ) : (
                    <div className="space-y-2">
                      {section.items.slice(0, 4).map((doc) => (
                        <div key={doc.id} className="rounded-[9px] bg-muted p-3 space-y-2">
                          <div>
                            <div className="text-sm font-medium text-foreground">{doc.title}</div>
                            <div className="text-[11px] text-muted-foreground">{dueDateLabel(doc.review_due_at)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {section.key === "overdue" ? (
                              <Link
                                href={`/admin/knowledge/admin/review/${doc.id}`}
                                className="rounded-[var(--radius)] px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-muted transition-colors"
                              >
                                Open review
                              </Link>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={actionLoading === doc.id}
                                onClick={() => void section.action(doc.id)}
                              >
                                {actionLoading === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : section.actionLabel}
                              </Button>
                            )}
                            <Link
                              href={`/admin/knowledge/admin/review/${doc.id}`}
                              className="rounded-[var(--radius)] px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                            >
                              Review
                            </Link>
                          </div>
                        </div>
                      ))}
                      {section.items.length > 4 ? (
                        <div className="text-[11px] text-muted-foreground">
                          {section.items.length - 4} more document{section.items.length - 4 === 1 ? "" : "s"} in this bucket.
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div id="doctrine-ready-to-publish" className="rounded-[var(--radius)] border border-success/30 bg-success/10 p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <div>
              <h3 className="text-sm font-semibold text-success">Ready to Publish</h3>
              <p className="text-xs text-success">
                Pending-review documents that already have an owner, a due date, an Obsidian draft, and a recorded review completion.
              </p>
            </div>
          </div>
          {doctrineMetrics.readyDocs.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionLoading === `bulk-publish:${doctrineMetrics.readyDocs.length}`}
              onClick={() => void runPublishBulk(doctrineMetrics.readyDocs.map((doc) => doc.id))}
            >
              {actionLoading === `bulk-publish:${doctrineMetrics.readyDocs.length}`
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : "Publish all ready"}
            </Button>
          ) : null}
        </div>

        {doctrineMetrics.readyDocs.length === 0 ? (
          <div className="text-xs text-success">Nothing is ready for publication right now.</div>
        ) : (
          <div className="space-y-2">
            {doctrineMetrics.readyDocs.slice(0, 6).map((doc) => (
              <div key={doc.id} className="min-h-[36px] rounded-[9px] border border-border bg-card px-[13px] py-2 hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{doc.title}</div>
                    <div className="text-[11px] text-muted-foreground">{dueDateLabel(doc.review_due_at)}</div>
                  </div>
                  <div className="text-xs font-semibold text-success">Ready</div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={actionLoading === doc.id}
                    onClick={() => void runPublish(doc.id)}
                  >
                    {actionLoading === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Publish now"}
                  </Button>
                  <Link
                    href={`/admin/knowledge/admin/review/${doc.id}`}
                    className="rounded-[var(--radius)] px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
            {doctrineMetrics.readyDocs.length > 6 ? (
              <div className="text-[11px] text-success">
                {doctrineMetrics.readyDocs.length - 6} more ready document{doctrineMetrics.readyDocs.length - 6 === 1 ? "" : "s"} in this queue.
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div id="doctrine-review-sla" className="rounded-[var(--radius)] border border-info/30 bg-info/10 p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-info" />
            <div>
              <h3 className="text-sm font-semibold text-info">Review SLA</h3>
              <p className="text-xs text-info">
                Pending-review documents that are due soon or already overdue.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { value: "all", label: `All (${reviewSlaRows.length})` },
              { value: "due_soon", label: `Due soon (${reviewSlaRows.filter((item) => item.status === "due_soon").length})` },
              { value: "overdue", label: `Overdue (${reviewSlaRows.filter((item) => item.status === "overdue").length})` },
            ] as Array<{ value: SlaFilter; label: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSlaFilter(option.value)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                  slaFilter === option.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {reviewSlaRows.length === 0 ? (
          <div className="text-xs text-info">No pending-review documents are near or past their due date right now.</div>
        ) : visibleSlaRows.length === 0 ? (
          <div className="text-xs text-info">No doctrine reviews match this SLA filter.</div>
        ) : (
          <div className="space-y-2">
            {visibleSlaRows.slice(0, 6).map((item) => (
              <div key={item.doc.id} className="min-h-[36px] rounded-[9px] border border-border bg-card px-[13px] py-2 hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{item.doc.title}</div>
                    <div className="text-[11px] text-muted-foreground">{dueDateLabel(item.doc.review_due_at)}</div>
                  </div>
                  <div
                    className={[
                      "text-xs font-semibold",
                      item.status === "overdue" ? "text-destructive" : "text-info",
                    ].join(" ")}
                  >
                    {item.status === "overdue"
                      ? `${Math.abs(item.diffDays)}d overdue`
                      : item.diffDays === 0
                        ? "Due today"
                        : `Due in ${item.diffDays}d`}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Link
                    href={`/admin/knowledge/admin/review/${item.doc.id}`}
                    className="rounded-[var(--radius)] px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-muted transition-colors"
                  >
                    Open review
                  </Link>
                </div>
              </div>
            ))}
            {visibleSlaRows.length > 6 ? (
              <div className="text-[11px] text-info">
                {visibleSlaRows.length - 6} more doctrine review{visibleSlaRows.length - 6 === 1 ? "" : "s"} in this SLA view.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
