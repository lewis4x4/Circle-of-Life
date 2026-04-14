"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KBHealthMetrics, ChatInsight } from "../lib/types";

export function useKBHealth() {
  const supabase = useMemo(() => createClient(), []);
  const [health, setHealth] = useState<KBHealthMetrics | null>(null);
  const [insights, setInsights] = useState<ChatInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        totalDocsRes,
        publishedDocsRes,
        failedDocsRes,
        totalChunksRes,
        embeddedChunksRes,
        queryCountRes,
        positiveFbRes,
        negativeFbRes,
        gapCountRes,
      ] = await Promise.all([
        supabase.from("documents").select("*", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
        supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "ingest_failed").is("deleted_at", null),
        supabase.from("chunks").select("*", { count: "exact", head: true }),
        supabase.from("chunks").select("*", { count: "exact", head: true }).not("embedding", "is", null),
        supabase.from("chat_messages").select("*", { count: "exact", head: true }).eq("role", "user"),
        supabase.from("chat_messages").select("*", { count: "exact", head: true }).eq("feedback", "positive"),
        supabase.from("chat_messages").select("*", { count: "exact", head: true }).eq("feedback", "negative"),
        supabase.from("knowledge_gaps").select("*", { count: "exact", head: true }).eq("resolved", false),
      ]);

      const firstError = [
        totalDocsRes.error,
        publishedDocsRes.error,
        failedDocsRes.error,
        totalChunksRes.error,
        embeddedChunksRes.error,
        queryCountRes.error,
        positiveFbRes.error,
        negativeFbRes.error,
        gapCountRes.error,
      ].find(Boolean);

      if (firstError) throw firstError;

      const total = totalDocsRes.count ?? 0;
      const chunks = totalChunksRes.count ?? 0;

      setHealth({
        totalDocuments: total,
        publishedDocuments: publishedDocsRes.count ?? 0,
        totalChunks: chunks,
        embeddingCoverage: chunks > 0 ? ((embeddedChunksRes.count ?? 0) / chunks) * 100 : 0,
        staleDocuments: 0,
        failedIngestions: failedDocsRes.count ?? 0,
        avgChunksPerDoc: total > 0 ? chunks / total : 0,
      });

      setInsights({
        totalQueries: queryCountRes.count ?? 0,
        uniqueUsers: 0,
        avgTokensPerQuery: 0,
        topTopics: [],
        positiveFeedback: positiveFbRes.count ?? 0,
        negativeFeedback: negativeFbRes.count ?? 0,
        gapCount: gapCountRes.count ?? 0,
      });
    } catch (loadError) {
      setHealth(null);
      setInsights(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load knowledge health.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return { health, insights, loading, error, reload: load };
}
