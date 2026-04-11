"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatConversationRow } from "../lib/types";

export function useConversations() {
  const supabase = useMemo(() => createClient(), []);
  const [conversations, setConversations] = useState<ChatConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("chat_conversations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50);
    setConversations(data ?? []);
    setLoading(false);
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

  return { conversations, loading, reload: load, deleteConversation };
}
