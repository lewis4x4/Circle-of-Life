"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, StopCircle, Paperclip } from "lucide-react";
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
    <div className="relative flex min-h-0 flex-1 flex-col bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.12),transparent)] dark:bg-[#050505]">
      {workspaceError && (
        <div className="shrink-0 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-sm text-amber-100">
          {workspaceError}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {showEmpty && !workspaceLoading && workspaceId ? (
          <div className="flex min-h-full flex-col items-center justify-center py-6">
            <SuggestedPrompts onSelect={(p) => void handleSend(p)} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
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
                <div className="rounded-2xl bg-zinc-800/90 px-4 py-3 ring-1 ring-zinc-700/80">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800/90 bg-zinc-950/95 px-4 py-4 backdrop-blur-md pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex items-end gap-1 rounded-2xl border border-zinc-700/90 bg-zinc-900/90 p-2 pl-3 shadow-[0_-4px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/5">
            <button
              type="button"
              disabled
              className="mb-1 shrink-0 rounded-lg p-2.5 text-zinc-600"
              title="Attachments are not available yet"
              aria-disabled="true"
            >
              <Paperclip className="h-5 w-5" />
            </button>
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
              className="max-h-36 min-h-[52px] flex-1 resize-none border-0 bg-transparent py-3.5 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0 disabled:opacity-50"
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "52px";
                target.style.height = `${Math.min(Math.max(target.scrollHeight, 52), 144)}px`;
              }}
            />
            <button
              type="button"
              onClick={() => (isActive ? reset() : void handleSend())}
              disabled={(!isActive && !input.trim()) || inputDisabled}
              className={`mb-1 shrink-0 rounded-xl p-3 transition-colors ${
                isActive
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : input.trim()
                    ? "bg-indigo-600 text-white hover:bg-indigo-500"
                    : "cursor-not-allowed bg-zinc-800 text-zinc-600"
              }`}
              aria-label={isActive ? "Stop generating" : "Send message"}
            >
              {isActive ? <StopCircle className="h-5 w-5" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
          <p className="mt-2.5 text-center text-xs text-zinc-500">
            Press <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">Enter</kbd>{" "}
            to send ·{" "}
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              Shift+Enter
            </kbd>{" "}
            for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
