"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, FileText, Loader2, NotebookPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { DocumentAudience, DocumentAuditEventRow, DocumentRow, DocumentStatus } from "@/features/knowledge/lib/types";
import {
  adminUpdateDocument,
  createObsidianDraft,
  fetchDocumentAuditEvents,
} from "@/features/knowledge/lib/knowledge-api";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";

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
  userLabels?: Record<string, string>;
  reviewerOptions?: Array<{ id: string; label: string; appRole: string }>;
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

type PublishReadinessCheck = {
  key: string;
  label: string;
  passed: boolean;
};

export default function KnowledgeDocumentReviewPage() {
  const params = useParams<{ id: string }>();
  const documentId = typeof params?.id === "string" ? params.id : "";
  const { user, loading: authLoading } = useHavenAuth();

  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [auditEvents, setAuditEvents] = useState<DocumentAuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reviewDueAt, setReviewDueAt] = useState("");
  const [reviewOwner, setReviewOwner] = useState("");
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});
  const [reviewerOptions, setReviewerOptions] = useState<Array<{ id: string; label: string; appRole: string }>>([]);

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
      setReviewOwner(payload.document.review_owner ?? "");
      setUserLabels(payload.userLabels ?? {});
      setReviewerOptions(payload.reviewerOptions ?? []);
    } catch (loadError) {
      setDocument(null);
      setAuditEvents([]);
      setUserLabels({});
      setReviewerOptions([]);
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

  const saveReviewOwner = useCallback(async () => {
    if (!document) return;
    setActionError(null);
    setActionMessage(null);
    setActionLoading("owner");
    try {
      const result = await adminUpdateDocument(document.id, {
        review_owner: reviewOwner || null,
      });
      if (!result.ok) throw new Error(result.error);
      setActionMessage(reviewOwner ? "Review owner saved." : "Review owner cleared.");
      await load();
    } catch (ownerError) {
      setActionError(ownerError instanceof Error ? ownerError.message : "Could not save review owner.");
    } finally {
      setActionLoading(null);
    }
  }, [document, reviewOwner, load]);

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

  const markReviewComplete = useCallback(async () => {
    if (!document) return;
    setActionError(null);
    setActionMessage(null);
    setActionLoading("review_complete");
    try {
      const result = await adminUpdateDocument(document.id, { review_completed: true });
      if (!result.ok) throw new Error(result.error);
      setActionMessage("Review completion recorded.");
      await load();
    } catch (reviewError) {
      setActionError(reviewError instanceof Error ? reviewError.message : "Could not record review completion.");
    } finally {
      setActionLoading(null);
    }
  }, [document, load]);

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
      : (userLabels[document.review_owner] ?? "Assigned reviewer")
    : "Unassigned";
  const hasDraftAudit = auditEvents.some((event) => event.event_type === "obsidian_draft_created");
  const latestDraftEvent = auditEvents.find((event) => event.event_type === "obsidian_draft_created") ?? null;
  const latestReviewCompletedEvent = auditEvents.find((event) => event.event_type === "review_completed") ?? null;
  const latestReviewCompletedAt = latestReviewCompletedEvent?.created_at ?? null;
  const latestDraftAt = latestDraftEvent?.created_at ?? null;
  const reviewCompletedCurrent =
    latestReviewCompletedAt !== null &&
    (latestDraftAt === null || new Date(latestReviewCompletedAt).getTime() >= new Date(latestDraftAt).getTime());
  const publishChecks: PublishReadinessCheck[] = [
    {
      key: "review_owner",
      label: "A review owner is assigned",
      passed: Boolean(document?.review_owner),
    },
    {
      key: "review_due_at",
      label: "A review due date is set",
      passed: Boolean(document?.review_due_at),
    },
    {
      key: "draft",
      label: "An Obsidian draft has been created or refreshed",
      passed: hasDraftAudit,
    },
    {
      key: "review_complete",
      label: "A reviewer has explicitly marked the review complete",
      passed: reviewCompletedCurrent,
    },
    {
      key: "pending_review",
      label: "Document is in pending review status",
      passed: document?.status === "pending_review" || document?.status === "published",
    },
    {
      key: "ingest_failed",
      label: "Document is not in an ingest failed state",
      passed: document?.status !== "ingest_failed",
    },
  ];
  const publishReady = publishChecks.every((check) => check.passed);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <RecordDetailHeader
        title="Doctrine Review"
        subtitle="Review a KB upload, create or revisit its Obsidian draft, and move it through the doctrine workflow."
        backLink={{ label: "Knowledge Base Admin", href: "/admin/knowledge/admin" }}
      />

      {loading || authLoading ? (
        <div className="rounded-[8px] border border-border bg-card p-[14px] text-sm text-muted-foreground flex items-center justify-center gap-3 min-h-[120px]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading doctrine review…
        </div>
      ) : error || !document ? (
        <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Could not load doctrine review.</div>
            <div className="text-destructive/80">{error ?? "Document not found."}</div>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Retry review
          </Button>
        </div>
      ) : (
        <>
          {actionError && (
            <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
              {actionMessage}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <RecordDetailSection title="Document">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xl font-semibold leading-tight text-foreground">{document.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {document.summary || "No summary is available yet. Review the content and metadata before promotion."}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[8px] border border-border bg-muted/10 p-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{STATUS_LABELS[document.status as DocumentStatus] ?? document.status}</div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-muted/10 p-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Audience</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{AUDIENCE_LABELS[document.audience as DocumentAudience] ?? document.audience}</div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-muted/10 p-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Words</div>
                    <div className="mt-1 text-sm font-medium tabular-nums text-foreground">{document.word_count?.toLocaleString() ?? "—"}</div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-muted/10 p-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Mime Type</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{document.mime_type ?? "unknown"}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-[8px] border border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
                  Workflow: upload to review to Obsidian draft to doctrine promotion. A document should not jump straight from raw upload to Published without this review pass.
                </div>
              </RecordDetailSection>

              <RecordDetailSection title="Review actions">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <NotebookPen className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Actions</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={actionLoading === "assign"} onClick={() => void assignToMe()}>
                      {actionLoading === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign to me"}
                    </Button>
                    <Button type="button" variant="outline" disabled={actionLoading === "draft"} onClick={() => void handleDraft()}>
                      {actionLoading === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create / refresh draft"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={actionLoading === "review_complete"}
                      onClick={() => void markReviewComplete()}
                    >
                      {actionLoading === "review_complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark review complete"}
                    </Button>
                    <Button type="button" variant="outline" disabled={actionLoading === "pending_review"} onClick={() => void transitionStatus("pending_review")}>
                      {actionLoading === "pending_review" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move to pending review"}
                    </Button>
                    <Button type="button" disabled={actionLoading === "published" || !publishReady} onClick={() => void transitionStatus("published")}>
                      {actionLoading === "published" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish to Grace"}
                    </Button>
                    <Button type="button" variant="secondary" disabled={actionLoading === "archived"} onClick={() => void transitionStatus("archived")}>
                      {actionLoading === "archived" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Archive"}
                    </Button>
                  </div>

                  <div className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
                    <p className="font-medium">Publish readiness</p>
                    <ul className="mt-2 space-y-1">
                      {publishChecks.map((check) => (
                        <li key={check.key} className={check.passed ? "text-success" : "text-warning"}>
                          {check.passed ? "✓" : "•"} {check.label}
                        </li>
                      ))}
                    </ul>
                    {!publishReady ? (
                      <p className="mt-2 text-xs text-warning">
                        Complete the missing review steps before publishing this document to Grace.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <label htmlFor="review-owner" className="text-xs uppercase tracking-wider text-muted-foreground">
                        Review Owner
                      </label>
                      <select
                        id="review-owner"
                        value={reviewOwner}
                        onChange={(event) => setReviewOwner(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Unassigned</option>
                        {reviewerOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} ({option.appRole})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="outline" disabled={actionLoading === "owner"} onClick={() => void saveReviewOwner()}>
                        {actionLoading === "owner" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save owner"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-2">
                      <label htmlFor="review-due" className="text-xs uppercase tracking-wider text-muted-foreground">
                        Review Due Date
                      </label>
                      <input
                        id="review-due"
                        type="date"
                        value={reviewDueAt}
                        onChange={(event) => setReviewDueAt(event.target.value)}
                        className="w-full rounded-[8px] border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="outline" disabled={actionLoading === "due"} onClick={() => void saveReviewDueDate()}>
                        {actionLoading === "due" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save due date"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[8px] border border-border bg-muted/10 p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Review Owner</div>
                      <div className="mt-1 text-sm font-medium text-foreground">{currentReviewerLabel}</div>
                    </div>
                    <div className="rounded-[8px] border border-border bg-muted/10 p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Due</div>
                      <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {document.review_due_at ? new Date(document.review_due_at).toLocaleDateString() : "Not set"}
                      </div>
                    </div>
                    <div className="rounded-[8px] border border-border bg-muted/10 p-3 sm:col-span-2">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Review Completion</div>
                      <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {reviewCompletedCurrent
                          ? latestReviewCompletedEvent
                            ? new Date(latestReviewCompletedEvent.created_at).toLocaleString()
                            : "Recorded"
                          : "Not recorded"}
                      </div>
                      {reviewCompletedCurrent && latestReviewCompletedEvent?.actor_user_id ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          By {userLabels[latestReviewCompletedEvent.actor_user_id] ?? latestReviewCompletedEvent.actor_user_id}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </RecordDetailSection>
            </div>

            <div className="space-y-6">
              <RecordDetailSection title="Audit trail">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                  {auditEvents.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No document events recorded yet.</div>
                  ) : (
                    auditEvents.map((event) => {
                      const lines = formatMetadata(event.metadata);
                      return (
                        <div key={event.id} className="rounded-[8px] border border-border bg-muted/10 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground capitalize">
                              {formatEventTitle(event.event_type)}
                            </div>
                            <div className="text-xs tabular-nums text-muted-foreground">
                              {new Date(event.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {event.actor_user_id ? `Actor: ${userLabels[event.actor_user_id] ?? event.actor_user_id}` : "Actor unavailable"}
                          </div>
                          {lines.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
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
              </RecordDetailSection>

              <div className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  Recommended path:
                  <ol className="mt-2 space-y-1 list-decimal list-inside">
                    <li>Assign a reviewer and due date.</li>
                    <li>Create or refresh the Obsidian draft.</li>
                    <li>Review the draft and linked doctrine targets.</li>
                    <li>Record review completion, then publish only when ready.</li>
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
