"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  section_title: string | null;
  page_number: number | null;
  content: string;
  document_title: string;
  audience: string | null;
  compliance_category: string | null;
  regulation_citation: string | null;
  document_status: string;
  document_updated_at: string | null;
};

/**
 * KB-NEXT-06: read-only document viewer used as the deep-link target for
 * citation anchors emitted by knowledge-agent. Renders chunks in stable
 * `chunk_index` order, scrolls to `?anchor=<chunk_id>`, and highlights the
 * anchored chunk so the user can verify what the AI cited.
 *
 * RLS gates the underlying vw_kb_chunk_anchor view; no service-role calls
 * here. If the user can't see a doc they get an empty render.
 */
export default function KnowledgeDocumentRoute() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const anchorChunkId = search.get("anchor");
  const documentId = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // The generated database.ts types are regenerated on demand and don't
        // yet know about vw_kb_chunk_anchor (KB-NEXT-06). Cast the table name
        // to `never` so the PostgREST client accepts it without losing the
        // runtime URL — typing of the returned rows is asserted below.
        const { data, error: qErr } = await supabase
          .from("vw_kb_chunk_anchor" as never)
          .select("*")
          .eq("document_id" as never, documentId as never)
          .order("chunk_index" as never, { ascending: true });
        if (cancelled) return;
        if (qErr) {
          setError(qErr.message);
          setChunks([]);
        } else {
          setChunks(((data ?? []) as unknown) as ChunkRow[]);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, supabase]);

  useEffect(() => {
    if (!anchorChunkId || chunks.length === 0) return;
    const el = document.getElementById(`chunk-${anchorChunkId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [anchorChunkId, chunks]);

  if (!documentId) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <p className="text-sm text-slate-500">Missing document id.</p>
      </div>
    );
  }

  const headerDoc = chunks[0];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Link
          href="/admin/knowledge/admin"
          className="text-xs text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Knowledge admin
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100 mt-2">
          {headerDoc?.document_title ?? "Knowledge document"}
        </h1>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-zinc-400">
          {headerDoc?.compliance_category ? (
            <span className="rounded border border-slate-200 dark:border-zinc-700 px-2 py-0.5">
              {headerDoc.compliance_category}
            </span>
          ) : null}
          {headerDoc?.regulation_citation ? (
            <span className="rounded border border-slate-200 dark:border-zinc-700 px-2 py-0.5">
              {headerDoc.regulation_citation}
            </span>
          ) : null}
          {headerDoc?.audience ? (
            <span className="rounded border border-slate-200 dark:border-zinc-700 px-2 py-0.5">
              audience: {headerDoc.audience}
            </span>
          ) : null}
          {headerDoc?.document_status ? (
            <span className="rounded border border-slate-200 dark:border-zinc-700 px-2 py-0.5">
              status: {headerDoc.document_status}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">Failed to load document: {error}</p>
      ) : chunks.length === 0 ? (
        <p className="text-sm text-slate-500">
          This document has no readable chunks, or you don&apos;t have access.
        </p>
      ) : (
        <ol className="space-y-4">
          {chunks.map((chunk) => {
            const isAnchor = anchorChunkId === chunk.chunk_id;
            return (
              <li
                key={chunk.chunk_id}
                id={`chunk-${chunk.chunk_id}`}
                className={[
                  "rounded border px-4 py-3 text-sm leading-6 whitespace-pre-wrap",
                  isAnchor
                    ? "border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/40"
                    : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900",
                ].join(" ")}
              >
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
                  <span>
                    Section {chunk.chunk_index + 1}
                    {chunk.section_title ? ` · ${chunk.section_title}` : ""}
                    {chunk.page_number != null ? ` · page ${chunk.page_number}` : ""}
                  </span>
                  {isAnchor ? (
                    <span className="font-medium text-amber-700 dark:text-amber-300">
                      cited by AI
                    </span>
                  ) : null}
                </div>
                <div className="text-slate-800 dark:text-zinc-100">{chunk.content}</div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
