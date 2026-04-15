"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, FileWarning, Loader2, NotebookPen, UserRoundX } from "lucide-react";

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

export function DoctrineReviewQueue({ documents, onRefresh }: DoctrineReviewQueueProps) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useHavenAuth();
  const [auditEvents, setAuditEvents] = useState<DocumentAuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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
        .eq("event_type", "obsidian_draft_created")
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
    () => new Set(auditEvents.map((event) => event.document_id)),
    [auditEvents],
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
    const readyToPublish = pendingDocs.filter(
      (doc) => !!doc.review_owner && !!doc.review_due_at && draftCreatedIds.has(doc.id),
    ).length;
    const blockedPending = pendingDocs.length - readyToPublish;
    const dueSoon = pendingDocs.filter((doc) => isDueSoon(doc.review_due_at, today)).length;
    const publishedThisWeek = documents.filter((doc) => {
      if (!doc.approved_at || doc.status !== "published") return false;
      const approvedAt = new Date(doc.approved_at);
      return approvedAt.getTime() >= Date.now() - 7 * 86_400_000;
    }).length;
    return {
      pendingDocs,
      readyToPublish,
      blockedPending,
      dueSoon,
      publishedThisWeek,
    };
  }, [documents, draftCreatedIds, today]);

  const publishBlockers = useMemo(() => {
    return doctrineMetrics.pendingDocs
      .map((doc) => {
        const blockers: string[] = [];
        if (!doc.review_owner) blockers.push("no reviewer");
        if (!doc.review_due_at) blockers.push("no due date");
        if (!draftCreatedIds.has(doc.id)) blockers.push("no draft");
        return { doc, blockers };
      })
      .filter((item) => item.blockers.length > 0)
      .slice(0, 4);
  }, [doctrineMetrics.pendingDocs, draftCreatedIds]);

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
      tone: "text-violet-600 dark:text-violet-300",
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
      tone: "text-amber-600 dark:text-amber-300",
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
      tone: "text-rose-600 dark:text-rose-300",
      items: buckets.overdue,
      actionLabel: "Open review",
      action: async () => {},
    },
  ];

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 px-3 py-2 text-sm text-green-800 dark:text-green-200">
          {actionMessage}
        </div>
      )}
      <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Pending review", value: doctrineMetrics.pendingDocs.length },
            { label: "Ready to publish", value: doctrineMetrics.readyToPublish },
            { label: "Blocked in review", value: doctrineMetrics.blockedPending },
            { label: "Due soon / published 7d", value: `${doctrineMetrics.dueSoon} / ${doctrineMetrics.publishedThisWeek}` },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
              <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">{metric.label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-zinc-100">{metric.value}</div>
            </div>
          ))}
        </div>

        {publishBlockers.length > 0 ? (
          <div className="rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">Top promotion blockers</h4>
              <p className="text-xs text-amber-800 dark:text-amber-200">These pending-review docs still have missing prerequisites.</p>
            </div>
            <div className="space-y-2">
              {publishBlockers.map(({ doc, blockers }) => (
                <Link
                  key={doc.id}
                  href={`/admin/knowledge/admin/review/${doc.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 dark:border-amber-900/30 bg-white/80 dark:bg-black/20 px-3 py-2 text-sm transition-colors hover:bg-white dark:hover:bg-black/30"
                >
                  <span className="font-medium text-slate-900 dark:text-zinc-100">{doc.title}</span>
                  <span className="text-xs text-amber-800 dark:text-amber-200">{blockers.join(" · ")}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <FileWarning className="h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">Stuck Uploads</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Uploaded documents that entered review but still need doctrine workflow actions.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-400 py-4 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading review backlog…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.key} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${section.tone}`} />
                      <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">{section.title}</div>
                    </div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-zinc-300">{section.items.length}</div>
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
                    <div className="text-xs text-slate-500 dark:text-zinc-400">Nothing stuck here right now.</div>
                  ) : (
                    <div className="space-y-2">
                      {section.items.slice(0, 4).map((doc) => (
                        <div key={doc.id} className="rounded-lg bg-slate-50 dark:bg-zinc-800/60 p-3 space-y-2">
                          <div>
                            <div className="text-sm font-medium text-slate-900 dark:text-zinc-100">{doc.title}</div>
                            <div className="text-[11px] text-slate-500 dark:text-zinc-400">{dueDateLabel(doc.review_due_at)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {section.key === "overdue" ? (
                              <Link
                                href={`/admin/knowledge/admin/review/${doc.id}`}
                                className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
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
                              className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
                            >
                              Review
                            </Link>
                          </div>
                        </div>
                      ))}
                      {section.items.length > 4 ? (
                        <div className="text-[11px] text-slate-500 dark:text-zinc-400">
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
    </div>
  );
}
