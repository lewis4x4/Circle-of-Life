"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { ChatInterface } from "../components/ChatInterface";
import { useConversations } from "../hooks/useConversations";
import { useKbWorkspaceId } from "../hooks/useKbWorkspaceId";
import type { ChatMessageRow } from "../lib/types";

export function ChatPage() {
  const supabase = useMemo(() => createClient(), []);
  const { workspaceId, loading: workspaceLoading, error: workspaceError } = useKbWorkspaceId();
  const { conversations, loading: convsLoading, error: convsError, reload: reloadConvs, deleteConversation } = useConversations();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const loadMessages = useCallback(
    async (convId: string) => {
      setMessagesLoading(true);
      setMessagesError(null);
      try {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("conversation_id", convId)
          .order("created_at", { ascending: true });
        if (error) {
          console.warn("[ChatPage] loadMessages", error.message);
          setMessagesError(error.message);
          setMessages([]);
        } else {
          setMessages(data ?? []);
        }
      } finally {
        setMessagesLoading(false);
      }
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
    setMessagesError(null);
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
        setMessagesError(null);
      }
    },
    [deleteConversation, activeConversationId],
  );

  const handleStreamFinished = useCallback(
    (conversationIdForReload?: string | null) => {
      const id = conversationIdForReload ?? activeConversationId;
      if (id) void loadMessages(id);
    },
    [activeConversationId, loadMessages],
  );

  return (
    <div className="-mx-6 -mt-6 mb-0 flex min-h-0 max-h-[calc(100dvh-7.5rem)] h-[calc(100dvh-7.5rem)] flex-1 lg:-mx-10">
      <div className="hidden h-full min-h-0 w-72 shrink-0 md:flex">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          loading={convsLoading}
          error={convsError}
          onSelect={setActiveConversationId}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
          onRetry={() => void reloadConvs()}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {messagesLoading && (
          <div className="shrink-0 border-b border-zinc-800/80 px-4 py-1.5 text-xs text-zinc-500">
            Loading messages…
          </div>
        )}
        {!messagesLoading && messagesError && activeConversationId && (
          <div className="shrink-0 border-b border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Could not load conversation history.</div>
              <div className="text-red-200/80">{messagesError}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadMessages(activeConversationId)}
              className="border-red-800/60 text-red-100 hover:bg-red-950/60 dark:border-red-800/60 dark:text-red-100 dark:hover:bg-red-950/60"
            >
              Retry messages
            </Button>
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
