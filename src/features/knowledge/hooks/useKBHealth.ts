"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildKBHealth } from "../lib/kb-health";
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

      const built = buildKBHealth({
        totalDocs: totalDocsRes,
        publishedDocs: publishedDocsRes,
        failedDocs: failedDocsRes,
        totalChunks: totalChunksRes,
        embeddedChunks: embeddedChunksRes,
        queryCount: queryCountRes,
        positiveFeedback: positiveFbRes,
        negativeFeedback: negativeFbRes,
        gapCount: gapCountRes,
      });
      setHealth(built.health);
      setInsights(built.insights);
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
