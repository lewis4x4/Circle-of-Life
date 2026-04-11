"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KBHealthMetrics, ChatInsight } from "../lib/types";

export function useKBHealth() {
  const supabase = useMemo(() => createClient(), []);
  const [health, setHealth] = useState<KBHealthMetrics | null>(null);
  const [insights, setInsights] = useState<ChatInsight | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    const { count: totalDocs } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);
    const { count: publishedDocs } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "published")
      .is("deleted_at", null);
    const { count: failedDocs } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "ingest_failed")
      .is("deleted_at", null);
    const { count: totalChunks } = await supabase.from("chunks").select("*", { count: "exact", head: true });
    const { count: embeddedChunks } = await supabase
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .not("embedding", "is", null);

    const total = totalDocs ?? 0;
    const chunks = totalChunks ?? 0;

    setHealth({
      totalDocuments: total,
      publishedDocuments: publishedDocs ?? 0,
      totalChunks: chunks,
      embeddingCoverage: chunks > 0 ? ((embeddedChunks ?? 0) / chunks) * 100 : 0,
      staleDocuments: 0,
      failedIngestions: failedDocs ?? 0,
      avgChunksPerDoc: total > 0 ? chunks / total : 0,
    });

    const { count: queryCount } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("role", "user");
    const { count: positiveFb } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("feedback", "positive");
    const { count: negativeFb } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("feedback", "negative");
    const { count: gapCount } = await supabase
      .from("knowledge_gaps")
      .select("*", { count: "exact", head: true })
      .eq("resolved", false);

    setInsights({
      totalQueries: queryCount ?? 0,
      uniqueUsers: 0,
      avgTokensPerQuery: 0,
      topTopics: [],
      positiveFeedback: positiveFb ?? 0,
      negativeFeedback: negativeFb ?? 0,
      gapCount: gapCount ?? 0,
    });

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return { health, insights, loading, reload: load };
}
