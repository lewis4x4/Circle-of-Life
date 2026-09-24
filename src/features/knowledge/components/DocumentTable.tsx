"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { FileText, Trash2, RefreshCw, Loader2 } from "lucide-react";
import type { DocumentRow, DocumentAudience, DocumentStatus } from "../lib/types";
import { adminUpdateDocument, adminDeleteDocument, createObsidianDraft, reindexDocument } from "../lib/knowledge-api";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { formatDocumentWordCount } from "@/lib/knowledge/document-word-count-display-copy";
import { knowledgeReviewDueLabel, knowledgeReviewOwnerLabel } from "@/lib/knowledge/review-queue-display-copy";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { markdownToPlainText } from "@/lib/knowledge/markdown-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ReviewFilter = "all" | "ready" | "assigned_to_me" | "unassigned" | "overdue";

interface DocumentTableProps {
  documents: DocumentRow[];
  onRefresh: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  published: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  draft: "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400",
  pending_review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  archived: "bg-slate-100 text-muted-foreground dark:bg-zinc-800",
  ingest_failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_HELP: Record<DocumentStatus, string> = {
  draft: "Uploaded but not yet ready for live use.",
  pending_review: "Indexed and ready for a human review pass.",
  published: "Published: staff can find it in knowledge search and Grace.",
  archived: "Hidden from active knowledge use.",
  ingest_failed: "Indexing failed. Use Re-index after the source issue is fixed.",
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  published: "Published",
  archived: "Archived",
  ingest_failed: "Ingest Failed",
};

/**
 * A status or audience change decides who can read a document (staff search and
 * Grace), so a select never applies it on its own: the change waits for an
 * explicit confirmation (COL-662).
 */
type PendingDocumentChange =
  | { kind: "status"; docId: string; title: string; from: DocumentStatus; to: DocumentStatus }
  | { kind: "audience"; docId: string; title: string; from: DocumentAudience; to: DocumentAudience };

function pendingChangeDescription(change: PendingDocumentChange): string {
  if (change.kind === "status") {
    return `${STATUS_LABELS[change.from] ?? change.from} → ${STATUS_LABELS[change.to] ?? change.to}. ${STATUS_HELP[change.to] ?? ""}`.trim();
  }
  return `${AUDIENCE_LABELS[change.from] ?? change.from} → ${AUDIENCE_LABELS[change.to] ?? change.to}. This changes who can find it in knowledge search and Grace.`;
}

const AUDIENCE_LABELS: Record<string, string> = {
  company_wide: "All Staff",
  department_specific: "Department",
  leadership: "Leadership",
  admin_owner: "Admin/Owner",
  owner_only: "Owner Only",
};

export function DocumentTable({ documents, onRefresh }: DocumentTableProps) {
  const { user } = useHavenAuth();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingDocumentChange | null>(null);

  const today = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, []);

  const reviewCounts = useMemo(() => {
    let ready = 0;
    let assignedToMe = 0;
    let unassigned = 0;
    let overdue = 0;

    for (const doc of documents) {
      const readyForReview = doc.status === "pending_review";
      if (!readyForReview) continue;
      ready += 1;
      if (!doc.review_owner) unassigned += 1;
      if (user?.id && doc.review_owner === user.id) assignedToMe += 1;
      if (doc.review_due_at) {
        const due = new Date(doc.review_due_at);
        due.setHours(0, 0, 0, 0);
        if (due < today) overdue += 1;
      }
    }

    return { ready, assignedToMe, unassigned, overdue };
  }, [documents, today, user?.id]);

  const filtered = useMemo(() => {
    return documents.filter((doc) => {
      if (!doc.title.toLowerCase().includes(filter.toLowerCase())) return false;
      switch (reviewFilter) {
        case "ready":
          return doc.status === "pending_review";
        case "assigned_to_me":
          return doc.status === "pending_review" && !!user?.id && doc.review_owner === user.id;
        case "unassigned":
          return doc.status === "pending_review" && !doc.review_owner;
        case "overdue":
          if (doc.status !== "pending_review" || !doc.review_due_at) return false;
          return new Date(doc.review_due_at) < today;
        default:
          return true;
      }
    });
  }, [documents, filter, reviewFilter, today, user?.id]);

  const reviewOwnerLabel = (doc: DocumentRow) => knowledgeReviewOwnerLabel(doc, user?.id);

  const handleStatusChange = async (docId: string, status: DocumentStatus) => {
    setActionSuccess(null);
    setActionError(null);
    setActionLoading(docId);
    try {
      const result = await adminUpdateDocument(docId, { status });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleAudienceChange = async (docId: string, audience: DocumentAudience) => {
    setActionSuccess(null);
    setActionError(null);
    setActionLoading(docId);
    try {
      const result = await adminUpdateDocument(docId, { audience });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document? This removes it from the knowledge base.")) return;
    setActionSuccess(null);
    setActionError(null);
    setActionLoading(docId);
    try {
      const result = await adminDeleteDocument(docId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleReindex = async (docId: string) => {
    setActionSuccess(null);
    setActionError(null);
    setActionLoading(docId);
    try {
      const result = await reindexDocument(docId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateDraft = async (docId: string) => {
    setActionSuccess(null);
    setActionError(null);
    setActionLoading(docId);
    try {
      const result = await createObsidianDraft(docId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      const payload =
        result.data && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : null;
      const skipped = payload?.skipped === true;
      const message =
        payload && typeof payload.message === "string"
          ? payload.message
          : "";
      const notePath =
        payload && typeof payload.notePath === "string"
          ? payload.notePath
          : "";
      setActionSuccess(
        skipped
          ? message || "Obsidian draft skipped because this runtime cannot access the local vault."
          : notePath
            ? `Obsidian draft created: ${notePath}`
            : "Obsidian draft created.",
      );
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 px-3 py-2 text-sm text-green-800 dark:text-green-200">
          {actionSuccess}
        </div>
      )}
      <input aria-label="Filter documents"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter documents…"
        className="w-full rounded-[8px] border border-input bg-background px-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { key: "ready", label: "Ready for review", value: reviewCounts.ready },
          { key: "assigned_to_me", label: "Assigned to me", value: reviewCounts.assignedToMe },
          { key: "unassigned", label: "Unassigned", value: reviewCounts.unassigned },
          { key: "overdue", label: "Overdue", value: reviewCounts.overdue },
        ].map((card) => {
          const active = reviewFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setReviewFilter(active ? "all" : (card.key as ReviewFilter))}
              className={`rounded-[9px] border px-4 py-3 text-left transition-colors ${
                active
                  ? "border-primary/35 bg-primary/5"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{card.label}</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{card.value}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "all", label: "All docs" },
          { key: "ready", label: "Ready for review" },
          { key: "assigned_to_me", label: "Assigned to me" },
          { key: "unassigned", label: "Unassigned" },
          { key: "overdue", label: "Overdue" },
        ].map((option) => {
          const active = reviewFilter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setReviewFilter(option.key as ReviewFilter)}
              className={`rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
        <HorizontalScroll label="Knowledge documents">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-zinc-900 text-left">
                <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Title</th>
                <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Status</th>
                <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Review</th>
                <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Audience</th>
                <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Words</th>
                <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {filtered.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-medium text-slate-800 dark:text-zinc-200">{doc.title}</div>
                        {doc.summary && (
                          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{markdownToPlainText(doc.summary)}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <select
                        aria-label={`Status for ${doc.title}`}
                        value={doc.status}
                        onChange={(e) => {
                          const to = e.target.value as DocumentStatus;
                          if (to === doc.status) return;
                          setPendingChange({ kind: "status", docId: doc.id, title: doc.title, from: doc.status as DocumentStatus, to });
                        }}
                        className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_COLORS[doc.status] ?? STATUS_COLORS.draft}`}
                      >
                        <option value="draft">Draft</option>
                        <option value="pending_review">Pending Review</option>
                        <option value="published">Published</option>
                        <option value="archived">Archived</option>
                        <option value="ingest_failed">Ingest Failed</option>
                      </select>
                      <div className="text-[11px] text-muted-foreground max-w-[220px]">
                        {STATUS_HELP[doc.status as DocumentStatus] ?? STATUS_HELP.draft}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1 text-xs text-slate-600 dark:text-zinc-300">
                      <div className="font-medium">{reviewOwnerLabel(doc)}</div>
                      {knowledgeReviewDueLabel(doc) ? (
                        <div className="text-muted-foreground">{knowledgeReviewDueLabel(doc)}</div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Audience for ${doc.title}`}
                      value={doc.audience}
                      onChange={(e) => {
                        const to = e.target.value as DocumentAudience;
                        if (to === doc.audience) return;
                        setPendingChange({ kind: "audience", docId: doc.id, title: doc.title, from: doc.audience as DocumentAudience, to });
                      }}
                      className="text-xs rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 cursor-pointer"
                    >
                      {Object.entries(AUDIENCE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDocumentWordCount(doc.word_count)}
                  </td>
                  <td className="px-4 py-3">
                    {actionLoading === doc.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void handleReindex(doc.id)}
                          title="Re-index document"
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCreateDraft(doc.id)}
                          title="Create Obsidian draft"
                          className="rounded-[8px] px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-muted/40"
                        >
                          Draft
                        </button>
                        <Link
                          href={`/admin/knowledge/admin/review/${doc.id}`}
                          className="rounded-[8px] px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-muted/40"
                        >
                          Review
                        </Link>
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc.id)}
                          title="Delete"
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No documents found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </HorizontalScroll>
      </div>

      <Dialog
        open={pendingChange !== null}
        onOpenChange={(open) => {
          if (!open && actionLoading === null) setPendingChange(null);
        }}
      >
        <DialogContent className="max-w-md">
          {pendingChange ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pendingChange.kind === "status" ? "Change status" : "Change audience"} for {pendingChange.title}?
                </DialogTitle>
                <DialogDescription>{pendingChangeDescription(pendingChange)}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPendingChange(null)} disabled={actionLoading !== null}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={actionLoading !== null}
                  onClick={async () => {
                    const change = pendingChange;
                    if (change.kind === "status") await handleStatusChange(change.docId, change.to);
                    else await handleAudienceChange(change.docId, change.to);
                    setPendingChange(null);
                  }}
                >
                  {pendingChange.kind === "status" ? `Set to ${STATUS_LABELS[pendingChange.to] ?? pendingChange.to}` : "Change audience"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
