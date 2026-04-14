"use client";

import React, { useState } from "react";
import { FileText, Trash2, RefreshCw, Loader2 } from "lucide-react";
import type { DocumentRow, DocumentAudience, DocumentStatus } from "../lib/types";
import { adminUpdateDocument, adminDeleteDocument, createObsidianDraft, reindexDocument } from "../lib/knowledge-api";

interface DocumentTableProps {
  documents: DocumentRow[];
  onRefresh: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  published: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  draft: "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400",
  pending_review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  archived: "bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-500",
  ingest_failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const AUDIENCE_LABELS: Record<string, string> = {
  company_wide: "All Staff",
  department_specific: "Department",
  leadership: "Leadership",
  admin_owner: "Admin/Owner",
  owner_only: "Owner Only",
};

export function DocumentTable({ documents, onRefresh }: DocumentTableProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const filtered = documents.filter((d) => d.title.toLowerCase().includes(filter.toLowerCase()));

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
      const notePath =
        payload && typeof payload.notePath === "string"
          ? payload.notePath
          : "";
      setActionSuccess(notePath ? `Obsidian draft created: ${notePath}` : "Obsidian draft created.");
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
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter documents…"
        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-zinc-900 text-left">
              <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Title</th>
              <th className="px-4 py-3 font-medium text-slate-600 dark:text-zinc-400">Status</th>
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
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <div className="font-medium text-slate-800 dark:text-zinc-200">{doc.title}</div>
                      {doc.summary && (
                        <div className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-1 mt-0.5">{doc.summary}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={doc.status}
                    onChange={(e) => void handleStatusChange(doc.id, e.target.value as DocumentStatus)}
                    className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_COLORS[doc.status] ?? STATUS_COLORS.draft}`}
                  >
                    <option value="draft">Draft</option>
                    <option value="pending_review">Pending Review</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={doc.audience}
                    onChange={(e) => void handleAudienceChange(doc.id, e.target.value as DocumentAudience)}
                    className="text-xs rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 cursor-pointer"
                  >
                    {Object.entries(AUDIENCE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500 dark:text-zinc-400">
                  {doc.word_count?.toLocaleString() ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {actionLoading === doc.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  ) : (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void handleReindex(doc.id)}
                        title="Re-index"
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateDraft(doc.id)}
                        title="Create Obsidian draft"
                        className="px-2 py-1.5 rounded-lg text-[11px] font-medium text-violet-600 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                      >
                        Draft
                      </button>
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
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-zinc-500">
                  No documents found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
