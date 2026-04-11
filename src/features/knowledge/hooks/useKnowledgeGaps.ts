"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KnowledgeGapRow } from "../lib/types";

export function useKnowledgeGaps() {
  const supabase = useMemo(() => createClient(), []);
  const [gaps, setGaps] = useState<KnowledgeGapRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("knowledge_gaps")
      .select("*")
      .order("frequency", { ascending: false })
      .limit(100);
    setGaps(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const resolve = useCallback(
    async (gapId: string, documentId?: string) => {
      await supabase
        .from("knowledge_gaps")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolution_document_id: documentId ?? null,
        })
        .eq("id", gapId);
      await load();
    },
    [supabase, load],
  );

  return { gaps, loading, reload: load, resolve };
}
