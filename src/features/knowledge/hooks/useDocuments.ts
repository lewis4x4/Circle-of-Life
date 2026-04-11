"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow } from "../lib/types";

export function useDocuments() {
  const supabase = useMemo(() => createClient(), []);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("documents")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setDocuments(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return { documents, loading, reload: load };
}
