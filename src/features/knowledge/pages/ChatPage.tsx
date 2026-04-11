"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { ChatInterface } from "../components/ChatInterface";
import { useConversations } from "../hooks/useConversations";
import { useKbWorkspaceId } from "../hooks/useKbWorkspaceId";
import type { ChatMessageRow } from "../lib/types";

export function ChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const { workspaceId, loading: workspaceLoading, error: workspaceError } = useKbWorkspaceId();
  const { conversations, loading: convsLoading, reload: reloadConvs, deleteConversation } = useConversations();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const loadMessages = useCallback(
    async (convId: string) => {
      setMessagesLoading(true);
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      setMessages(data ?? []);
      setMessagesLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    queueMicrotask(() => {
      if (activeConversationId) {
        void loadMessages(activeConversationId);
      } else {
        setMessages([]);
      }
    });
  }, [activeConversationId, loadMessages]);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  const handleConversationCreated = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      void reloadConvs();
    },
    [reloadConvs],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
    },
    [deleteConversation, activeConversationId],
  );

  const handleStreamFinished = useCallback(() => {
    if (activeConversationId) {
      void loadMessages(activeConversationId);
    }
  }, [activeConversationId, loadMessages]);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <div className="w-64 shrink-0 hidden md:block">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          loading={convsLoading}
          onSelect={setActiveConversationId}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {messagesLoading && (
          <div className="text-xs text-slate-400 px-4 py-1 border-b border-slate-200 dark:border-zinc-800">Loading messages…</div>
        )}
        <ChatInterface
          conversationId={activeConversationId}
          existingMessages={messages}
          onConversationCreated={handleConversationCreated}
          workspaceId={workspaceId}
          workspaceLoading={workspaceLoading}
          workspaceError={workspaceError}
          onStreamFinished={handleStreamFinished}
        />
      </div>
    </div>
  );
}
