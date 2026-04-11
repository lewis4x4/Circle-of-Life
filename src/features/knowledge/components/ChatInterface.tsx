"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, StopCircle } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { useKnowledgeStream } from "../hooks/useKnowledgeStream";
import type { ChatMessageRow, KBSource } from "../lib/types";

interface ChatInterfaceProps {
  conversationId: string | null;
  existingMessages: ChatMessageRow[];
  onConversationCreated: (id: string) => void;
  workspaceId: string | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  onStreamFinished?: () => void;
}

export function ChatInterface({
  conversationId,
  existingMessages,
  onConversationCreated,
  workspaceId,
  workspaceLoading,
  workspaceError,
  onStreamFinished,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const { state, text, sources, meta, error, send, reset } = useKnowledgeStream(workspaceId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [existingMessages, text, scrollToBottom]);

  const handleSend = useCallback(
    async (message?: string) => {
      const msg = (message ?? input).trim();
      if (!msg || state === "connecting" || state === "streaming") return;
      if (!workspaceId || workspaceLoading) return;
      setInput("");
      await send(msg, conversationId ?? undefined);
    },
    [input, state, conversationId, send, workspaceId, workspaceLoading],
  );

  useEffect(() => {
    if (state === "done" && meta?.conversation_id && !conversationId) {
      onConversationCreated(meta.conversation_id);
    }
  }, [state, meta, conversationId, onConversationCreated]);

  useEffect(() => {
    if (state === "done" && conversationId) {
      onStreamFinished?.();
    }
  }, [state, conversationId, onStreamFinished]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const isActive = state === "connecting" || state === "streaming";
  const showEmpty = existingMessages.length === 0 && state === "idle";
  const inputDisabled = !workspaceId || workspaceLoading;

  return (
    <div className="flex flex-col h-full">
      {workspaceError && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          {workspaceError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {showEmpty && !workspaceLoading && workspaceId && <SuggestedPrompts onSelect={(p) => void handleSend(p)} />}

        {existingMessages.map((msg) => (
          <ChatMessage
            key={msg.id}
            id={msg.id}
            role={msg.role as "user" | "assistant"}
            content={msg.content}
            sources={msg.sources as unknown as KBSource[] | undefined}
            feedback={msg.feedback}
          />
        ))}

        {isActive && text && (
          <ChatMessage
            role="assistant"
            content={text}
            sources={sources}
            isStreaming={state === "streaming"}
          />
        )}

        {state === "connecting" && (
          <div className="flex gap-3">
            <div className="bg-slate-100 dark:bg-zinc-800 rounded-2xl px-4 py-3">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              inputDisabled ? "Loading organization…" : "Ask about policies, procedures, compliance…"
            }
            rows={1}
            disabled={inputDisabled}
            className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-60"
            style={{ minHeight: "44px", maxHeight: "120px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "44px";
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <button
            type="button"
            onClick={() => (isActive ? reset() : void handleSend())}
            disabled={(!isActive && !input.trim()) || inputDisabled}
            className={`shrink-0 rounded-xl p-3 transition-colors ${
              isActive
                ? "bg-red-500 text-white hover:bg-red-600"
                : input.trim()
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-slate-100 dark:bg-zinc-800 text-slate-400 cursor-not-allowed"
            }`}
          >
            {isActive ? <StopCircle className="w-5 h-5" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
