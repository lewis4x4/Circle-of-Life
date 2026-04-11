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
    <div className="-mx-6 -mt-6 mb-0 flex min-h-0 max-h-[calc(100dvh-7.5rem)] h-[calc(100dvh-7.5rem)] flex-1 lg:-mx-10">
      <div className="hidden h-full min-h-0 w-72 shrink-0 md:flex">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          loading={convsLoading}
          onSelect={setActiveConversationId}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {messagesLoading && (
          <div className="shrink-0 border-b border-zinc-800/80 px-4 py-1.5 text-xs text-zinc-500">
            Loading messages…
          </div>
        )}
        <ChatInterface
          conversationId={activeConversationId}
          existingMessages={messages}
          messagesLoading={messagesLoading}
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
