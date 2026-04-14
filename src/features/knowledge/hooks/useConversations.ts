"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatConversationRow } from "../lib/types";

export function useConversations() {
  const supabase = useMemo(() => createClient(), []);
  const [conversations, setConversations] = useState<ChatConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("chat_conversations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      setConversations(data ?? []);
    } catch (loadError) {
      console.warn("[useConversations]", loadError);
      setConversations([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load conversations.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const deleteConversation = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("chat_conversations").delete().eq("id", id);
      if (error) {
        console.warn("[useConversations] delete failed", error.message);
        return;
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
    },
    [supabase],
  );

  return { conversations, loading, error, reload: load, deleteConversation };
}
