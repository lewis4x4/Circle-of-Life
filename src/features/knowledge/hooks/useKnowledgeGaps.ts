"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KnowledgeGapRow } from "../lib/types";

export function useKnowledgeGaps() {
  const supabase = useMemo(() => createClient(), []);
  const [gaps, setGaps] = useState<KnowledgeGapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("knowledge_gaps")
        .select("*")
        .order("frequency", { ascending: false })
        .limit(100);
      if (queryError) throw queryError;
      setGaps(data ?? []);
    } catch (loadError) {
      setGaps([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load knowledge gaps.");
      console.warn("[useKnowledgeGaps] load failed", loadError);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const resolve = useCallback(
    async (gapId: string, documentId?: string) => {
      setResolveError(null);
      const { error } = await supabase
        .from("knowledge_gaps")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolution_document_id: documentId ?? null,
        })
        .eq("id", gapId);
      if (error) {
        setResolveError(error.message);
        return;
      }
      await load();
    },
    [supabase, load],
  );

  return { gaps, loading, error, reload: load, resolve, resolveError };
}
