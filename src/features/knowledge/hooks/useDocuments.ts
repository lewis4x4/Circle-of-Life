"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow } from "../lib/types";

export function useDocuments() {
  const supabase = useMemo(() => createClient(), []);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("documents")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (queryError) throw queryError;
      setDocuments(data ?? []);
    } catch (loadError) {
      setDocuments([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load knowledge documents.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return { documents, loading, error, reload: load };
}
