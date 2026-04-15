"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, Loader2, NotebookPen } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { cn } from "@/lib/utils";
import type { DocumentAudience, DocumentAuditEventRow, DocumentRow, DocumentStatus } from "@/features/knowledge/lib/types";
import {
  adminUpdateDocument,
  createObsidianDraft,
  fetchDocumentAuditEvents,
} from "@/features/knowledge/lib/knowledge-api";

type ReviewDocument = Pick<
  DocumentRow,
  | "id"
  | "title"
  | "status"
  | "audience"
  | "summary"
  | "word_count"
  | "mime_type"
  | "metadata"
  | "review_owner"
  | "review_due_at"
  | "approved_at"
  | "approved_by"
  | "classification_updated_at"
>;

type ReviewPayload = {
  ok: true;
  document: ReviewDocument;
  auditEvents: DocumentAuditEventRow[];
  currentUserId: string;
};

const AUDIENCE_LABELS: Record<DocumentAudience, string> = {
  company_wide: "All Staff",
  department_specific: "Department Specific",
  leadership: "Leadership Only",
  admin_owner: "Admin & Owner",
  owner_only: "Owner Only",
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  published: "Published",
  archived: "Archived",
  ingest_failed: "Ingest Failed",
};

function formatEventTitle(eventType: string): string {
  return eventType.replace(/_/g, " ");
}

function formatMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  return Object.entries(metadata as Record<string, unknown>).flatMap(([key, value]) => {
    if (value == null || value === "") return [];
    if (Array.isArray(value)) {
      return [`${key}: ${value.join(", ")}`];
    }
    if (typeof value === "object") {
      return [`${key}: ${JSON.stringify(value)}`];
    }
    return [`${key}: ${String(value)}`];
  });
}

export default function KnowledgeDocumentReviewPage() {
  const params = useParams<{ id: string }>();
  const documentId = typeof params?.id === "string" ? params.id : "";
  const supabase = useMemo(() => createClient(), []);
  const { user, loading: authLoading } = useHavenAuth();

  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [auditEvents, setAuditEvents] = useState<DocumentAuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reviewDueAt, setReviewDueAt] = useState("");

  const load = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDocumentAuditEvents(documentId);
      if (!result.ok) throw new Error(result.error);
      const payload = result.data as ReviewPayload;
      setDocument(payload.document);
      setAuditEvents(payload.auditEvents);
      setReviewDueAt(payload.document.review_due_at ? payload.document.review_due_at.slice(0, 10) : "");
    } catch (loadError) {
      setDocument(null);
      setAuditEvents([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load doctrine review.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignToMe = useCallback(async () => {
    if (!document || !user) return;
    setActionError(null);
    setActionMessage(null);
    setActionLoading("assign");
    try {
      const result = await adminUpdateDocument(document.id, { review_owner: user.id });
      if (!result.ok) throw new Error(result.error);
      setActionMessage("Review owner set to you.");
      await load();
    } catch (assignError) {
      setActionError(assignError instanceof Error ? assignError.message : "Could not assign review owner.");
    } finally {
      setActionLoading(null);
    }
  }, [document, user, load]);

  const saveReviewDueDate = useCallback(async () => {
    if (!document) return;
    setActionError(null);
    setActionMessage(null);
    setActionLoading("due");
    try {
      const result = await adminUpdateDocument(document.id, {
        review_due_at: reviewDueAt ? `${reviewDueAt}T12:00:00.000Z` : null,
      });
      if (!result.ok) throw new Error(result.error);
      setActionMessage(reviewDueAt ? "Review due date saved." : "Review due date cleared.");
      await load();
    } catch (dueError) {
      setActionError(dueError instanceof Error ? dueError.message : "Could not save review due date.");
    } finally {
      setActionLoading(null);
    }
  }, [document, reviewDueAt, load]);

  const transitionStatus = useCallback(async (status: DocumentStatus) => {
    if (!document) return;
    setActionError(null);
    setActionMessage(null);
    setActionLoading(status);
    try {
      const result = await adminUpdateDocument(document.id, { status });
      if (!result.ok) throw new Error(result.error);
      setActionMessage(`Document moved to ${STATUS_LABELS[status]}.`);
      await load();
    } catch (statusError) {
      setActionError(statusError instanceof Error ? statusError.message : "Could not update document status.");
    } finally {
      setActionLoading(null);
    }
  }, [document, load]);

  const handleDraft = useCallback(async () => {
    if (!document) return;
    setActionError(null);
    setActionMessage(null);
    setActionLoading("draft");
    try {
      const result = await createObsidianDraft(document.id);
      if (!result.ok) throw new Error(result.error);
      const payload = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
      const message = payload && typeof payload.message === "string"
        ? payload.message
        : payload && typeof payload.notePath === "string"
          ? `Obsidian draft created at ${payload.notePath}`
          : "Obsidian draft created.";
      setActionMessage(message);
      await load();
    } catch (draftError) {
      setActionError(draftError instanceof Error ? draftError.message : "Could not create Obsidian draft.");
    } finally {
      setActionLoading(null);
    }
  }, [document, load]);

  const currentReviewerLabel = document?.review_owner
    ? user?.id === document.review_owner
      ? "Assigned to you"
      : document.review_owner
    : "Unassigned";

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin/knowledge/admin"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Knowledge Base Admin
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Doctrine Review</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Review a KB upload, create or revisit its Obsidian draft, and move it through the doctrine workflow.
          </p>
        </div>
      </div>

      {loading || authLoading ? (
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-sm text-slate-500 dark:text-zinc-400 flex items-center justify-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading doctrine review…
        </div>
      ) : error || !document ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-4 text-sm text-red-800 dark:text-red-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Could not load doctrine review.</div>
            <div className="text-red-700/90 dark:text-red-200/90">{error ?? "Document not found."}</div>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} className="border-red-300 text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/60">
            Retry review
          </Button>
        </div>
      ) : (
        <>
          {actionError && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
              {actionMessage}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-slate-400 mt-0.5" />
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-zinc-100">{document.title}</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
                      {document.summary || "No summary is available yet. Review the content and metadata before promotion."}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">{STATUS_LABELS[document.status as DocumentStatus] ?? document.status}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Audience</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">{AUDIENCE_LABELS[document.audience as DocumentAudience] ?? document.audience}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Words</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">{document.word_count?.toLocaleString() ?? "—"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Mime Type</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">{document.mime_type ?? "unknown"}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-indigo-200/60 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
                  Workflow: upload to review to Obsidian draft to doctrine promotion. A document should not jump straight from raw upload to Published without this review pass.
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <NotebookPen className="h-5 w-5 text-violet-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Review Actions</h2>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={actionLoading === "assign"} onClick={() => void assignToMe()}>
                    {actionLoading === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign to me"}
                  </Button>
                  <Button type="button" variant="outline" disabled={actionLoading === "draft"} onClick={() => void handleDraft()}>
                    {actionLoading === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create / refresh draft"}
                  </Button>
                  <Button type="button" variant="outline" disabled={actionLoading === "pending_review"} onClick={() => void transitionStatus("pending_review")}>
                    {actionLoading === "pending_review" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move to pending review"}
                  </Button>
                  <Button type="button" disabled={actionLoading === "published"} onClick={() => void transitionStatus("published")}>
                    {actionLoading === "published" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish to Grace"}
                  </Button>
                  <Button type="button" variant="secondary" disabled={actionLoading === "archived"} onClick={() => void transitionStatus("archived")}>
                    {actionLoading === "archived" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Archive"}
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <label htmlFor="review-due" className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">
                      Review Due Date
                    </label>
                    <input
                      id="review-due"
                      type="date"
                      value={reviewDueAt}
                      onChange={(event) => setReviewDueAt(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" disabled={actionLoading === "due"} onClick={() => void saveReviewDueDate()}>
                      {actionLoading === "due" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save due date"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Review Owner</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">{currentReviewerLabel}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Due</div>
                    <div className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">
                      {document.review_due_at ? new Date(document.review_due_at).toLocaleDateString() : "Not set"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-indigo-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Audit Trail</h2>
                </div>
                <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                  {auditEvents.length === 0 ? (
                    <div className="text-sm text-slate-500 dark:text-zinc-400">No document events recorded yet.</div>
                  ) : (
                    auditEvents.map((event) => {
                      const lines = formatMetadata(event.metadata);
                      return (
                        <div key={event.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900 dark:text-zinc-100 capitalize">
                              {formatEventTitle(event.event_type)}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-zinc-400">
                              {new Date(event.created_at).toLocaleString()}
                            </div>
                          </div>
                          {lines.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-zinc-400">
                              {lines.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100 flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  Recommended path:
                  <ol className="mt-2 space-y-1 list-decimal list-inside">
                    <li>Assign a reviewer and due date.</li>
                    <li>Create or refresh the Obsidian draft.</li>
                    <li>Review the draft and linked doctrine targets.</li>
                    <li>Move to pending review, then publish only when ready.</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
