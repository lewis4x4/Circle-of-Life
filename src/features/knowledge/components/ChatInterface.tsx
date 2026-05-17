"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Send, Loader2, StopCircle, Paperclip, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./ChatMessage";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { useKnowledgeStream } from "../hooks/useKnowledgeStream";
import type { ChatMessageRow, KBSource } from "../lib/types";

interface ChatInterfaceProps {
  conversationId: string | null;
  existingMessages: ChatMessageRow[];
  /** True while fetching thread messages for the selected conversation */
  messagesLoading?: boolean;
  historyError?: string | null;
  onConversationCreated: (id: string) => void;
  workspaceId: string | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  onRetryWorkspace?: () => void;
  /** Pass conversation id when the thread was just created so messages reload correctly */
  onStreamFinished?: (conversationIdForReload?: string | null) => void;
}

export function ChatInterface({
  conversationId,
  existingMessages,
  messagesLoading = false,
  historyError = null,
  onConversationCreated,
  workspaceId,
  workspaceLoading,
  workspaceError,
  onRetryWorkspace,
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
  const showKbUploadHint = state === "done" && kbEmpty;
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
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      {workspaceError && (
        <div className="flex shrink-0 flex-col gap-3 border-b border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>{workspaceError}</div>
          {onRetryWorkspace ? (
            <Button
              type="button"
              variant="outline"
              onClick={onRetryWorkspace}
              className="border-warning/30 text-warning-foreground hover:bg-warning/15"
            >
              Retry workspace
            </Button>
          ) : null}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {showWelcome ? (
          <div className="flex min-h-[min(100%,360px)] flex-col items-center justify-center py-6">
            <SuggestedPrompts onSelect={(p) => void handleSend(p)} />
          </div>
        ) : conversationId == null && workspaceLoading ? (
          <div className="flex min-h-[min(100%,280px)] flex-col items-center justify-center gap-3 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">Loading organization…</p>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full min-h-[min(100%,240px)] max-w-3xl flex-col space-y-4 px-4 py-6">
            {showThreadLoader && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
                <p className="text-sm text-muted-foreground">Loading conversation…</p>
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
                    <div className="rounded-[9px] border border-border bg-card px-[13px] py-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
                    </div>
                    <span className="self-center text-sm text-muted-foreground">Generating answer…</span>
                  </div>
                )}
              </>
            )}

            {!showThreadLoader && state === "connecting" && !showOptimisticUser && (
              <div className="flex gap-3">
                <div className="rounded-[9px] border border-border bg-card px-[13px] py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              </div>
            )}

            {!showThreadLoader && showKbUploadHint && (
              <div className="flex gap-3 rounded-[9px] border border-warning/30 bg-warning/10 px-[13px] py-3 text-sm text-warning-foreground">
                <BookOpen className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">No matching documents in the knowledge base yet</p>
                  <p className="mt-1">
                    Live resident and operations questions can still work, but document-based answers need uploaded materials.
                    Add policies and handbooks in{" "}
                    <Link
                      href="/admin/knowledge/admin"
                      className="font-medium underline underline-offset-2 hover:text-foreground"
                    >
                      Knowledge admin
                    </Link>{" "}
                    so the agent can cite your real materials.
                  </p>
                </div>
              </div>
            )}

            {!showThreadLoader && error && (
              <div className="rounded-[9px] border border-destructive/30 bg-destructive/10 px-[13px] py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {!showThreadLoader &&
              existingMessages.length === 0 &&
              !isActive &&
              !error &&
              !historyError &&
              !text &&
              !!conversationId &&
              !messagesLoading && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    No messages in this conversation yet. Ask about residents, meds, census, incidents, compliance, or uploaded policies.
                  </p>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex items-end gap-1 rounded-[9px] border border-border bg-background p-2 pl-3">
            <button
              type="button"
              disabled
              className="mb-1 shrink-0 rounded-[8px] p-2.5 text-muted-foreground opacity-50"
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
                inputDisabled ? "Loading organization…" : "Ask about residents, meds, census, incidents, policies…"
              }
              rows={1}
              disabled={inputDisabled}
              className="max-h-36 min-h-[52px] flex-1 resize-none border-0 bg-transparent py-3.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-50"
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
              className={`mb-1 shrink-0 rounded-[8px] p-3 transition-colors ${
                isActive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : input.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
              }`}
              aria-label={isActive ? "Stop generating" : "Send message"}
            >
              {isActive ? <StopCircle className="h-5 w-5" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
          <p className="mt-2.5 text-center text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Enter</kbd>{" "}
            to send ·{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Shift+Enter
            </kbd>{" "}
            for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
