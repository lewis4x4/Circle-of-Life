"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Send, Loader2, StopCircle, Paperclip, BookOpen } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { useKnowledgeStream } from "../hooks/useKnowledgeStream";
import type { ChatMessageRow, KBSource } from "../lib/types";

interface ChatInterfaceProps {
  conversationId: string | null;
  existingMessages: ChatMessageRow[];
  /** True while fetching thread messages for the selected conversation */
  messagesLoading?: boolean;
  onConversationCreated: (id: string) => void;
  workspaceId: string | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  /** Pass conversation id when the thread was just created so messages reload correctly */
  onStreamFinished?: (conversationIdForReload?: string | null) => void;
}

export function ChatInterface({
  conversationId,
  existingMessages,
  messagesLoading = false,
  onConversationCreated,
  workspaceId,
  workspaceLoading,
  workspaceError,
  onStreamFinished,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const { state, text, sources, meta, error, pendingUserMessage, kbEmpty, send, reset } =
    useKnowledgeStream(workspaceId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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
    if (state !== "done") return;
    const conv = meta?.conversation_id;
    if (conv && !conversationId) {
      onConversationCreated(conv);
    }
    onStreamFinished?.(conv ?? conversationId ?? undefined);
  }, [state, meta, conversationId, onConversationCreated, onStreamFinished]);

  useEffect(() => {
    reset();
  }, [conversationId, reset]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const isActive = state === "connecting" || state === "streaming";
  const showOptimisticUser =
    !!pendingUserMessage &&
    !existingMessages.some((m) => m.role === "user" && m.content === pendingUserMessage);
  const lastMsg = useMemo(
    () => (existingMessages.length ? existingMessages[existingMessages.length - 1] : null),
    [existingMessages],
  );
  const lastMsgSources = lastMsg?.sources as unknown;
  const lastMsgHasKbSources = Array.isArray(lastMsgSources) && lastMsgSources.length > 0;
  /** Edge SSE kb_empty; after reload, newest assistant row has no cited sources (not an error response). */
  const showKbUploadHint =
    (state === "done" && kbEmpty) ||
    (!isActive &&
      !messagesLoading &&
      lastMsg?.role === "assistant" &&
      !String(lastMsg.content).startsWith("Error:") &&
      !lastMsgHasKbSources);
  const hasNoContent = existingMessages.length === 0 && !isActive && !text;

  useEffect(() => {
    scrollToBottom();
  }, [existingMessages, text, showKbUploadHint, scrollToBottom]);
  /** Welcome / suggested prompts only when no thread is selected — never when viewing history */
  const showWelcome =
    conversationId == null &&
    hasNoContent &&
    state !== "error" &&
    !workspaceLoading &&
    !!workspaceId;
  const inputDisabled = !workspaceId || workspaceLoading;
  const showThreadLoader = !!conversationId && messagesLoading && existingMessages.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.12),transparent)] dark:bg-[#050505]">
      {workspaceError && (
        <div className="shrink-0 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-sm text-amber-100">
          {workspaceError}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {showWelcome ? (
          <div className="flex min-h-[min(100%,360px)] flex-col items-center justify-center py-6">
            <SuggestedPrompts onSelect={(p) => void handleSend(p)} />
          </div>
        ) : conversationId == null && workspaceLoading ? (
          <div className="flex min-h-[min(100%,280px)] flex-col items-center justify-center gap-3 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" aria-hidden />
            <p className="text-sm text-zinc-500">Loading organization…</p>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full min-h-[min(100%,240px)] max-w-3xl flex-col space-y-4 px-4 py-6">
            {showThreadLoader && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" aria-hidden />
                <p className="text-sm text-zinc-500">Loading conversation…</p>
              </div>
            )}

            {!showThreadLoader &&
              existingMessages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  id={msg.id}
                  role={msg.role as "user" | "assistant"}
                  content={msg.content}
                  sources={msg.sources as unknown as KBSource[] | undefined}
                  feedback={msg.feedback}
                />
              ))}

            {!showThreadLoader && showOptimisticUser && (
              <ChatMessage role="user" content={pendingUserMessage!} />
            )}

            {!showThreadLoader && isActive && (
              <>
                {text ? (
                  <ChatMessage
                    role="assistant"
                    content={text}
                    sources={sources}
                    isStreaming={state === "streaming"}
                  />
                ) : (
                  <div className="flex gap-3">
                    <div className="rounded-2xl bg-zinc-800/90 px-4 py-3 ring-1 ring-zinc-700/80">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-400" aria-hidden />
                    </div>
                    <span className="self-center text-sm text-zinc-500">Generating answer…</span>
                  </div>
                )}
              </>
            )}

            {!showThreadLoader && state === "connecting" && !showOptimisticUser && (
              <div className="flex gap-3">
                <div className="rounded-2xl bg-zinc-800/90 px-4 py-3 ring-1 ring-zinc-700/80">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                </div>
              </div>
            )}

            {!showThreadLoader && showKbUploadHint && (
              <div className="flex gap-3 rounded-xl border border-amber-800/50 bg-amber-950/35 px-4 py-3 text-sm text-amber-100">
                <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
                <div>
                  <p className="font-medium text-amber-50">No matching documents in the knowledge base yet</p>
                  <p className="mt-1 text-amber-100/90">
                    Upload policies and handbooks in{" "}
                    <Link
                      href="/admin/knowledge/admin"
                      className="font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
                    >
                      Knowledge admin
                    </Link>{" "}
                    so answers can cite your real materials.
                  </p>
                </div>
              </div>
            )}

            {!showThreadLoader && error && (
              <div className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {!showThreadLoader &&
              existingMessages.length === 0 &&
              !isActive &&
              !error &&
              !text &&
              !!conversationId &&
              !messagesLoading && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <p className="text-sm text-zinc-400">
                    No messages in this conversation yet. Type a question below to get started.
                  </p>
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
