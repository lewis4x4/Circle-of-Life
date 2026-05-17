"use client";

import React from "react";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import type { ChatConversationRow } from "../lib/types";

interface ConversationSidebarProps {
  conversations: ChatConversationRow[];
  activeId: string | null;
  loading: boolean;
  error?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRetry?: () => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  loading,
  error,
  onSelect,
  onNew,
  onDelete,
  onRetry,
}: ConversationSidebarProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col border-r border-border bg-card">
      <div className="shrink-0 border-b border-border p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-[33px] w-full items-center justify-center gap-2 rounded-[8px] bg-primary px-[11px] py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && error && (
          <div className="space-y-3 rounded-[9px] border border-destructive/30 bg-destructive/10 px-[13px] py-3 text-sm text-destructive">
            <div>
              <div className="font-medium">Could not load conversations.</div>
              <div className="mt-1">{error}</div>
            </div>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-[8px] border border-destructive/30 px-3 py-2 text-xs font-medium transition-colors hover:bg-destructive/15"
              >
                Retry conversations
              </button>
            ) : null}
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex min-h-[33px] items-center gap-2 rounded-[8px] border px-[11px] py-2 transition-colors ${
              activeId === conv.id
                ? "border-primary/35 bg-primary/5"
                : "cursor-pointer border-transparent hover:bg-muted/40"
            }`}
            onClick={() => onSelect(conv.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(conv.id);
              }
            }}
            role="button"
            tabIndex={0}
            aria-current={activeId === conv.id ? "true" : undefined}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{conv.title || "Untitled chat"}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="shrink-0 rounded-md p-1.5 opacity-0 transition hover:bg-destructive/10 group-hover:opacity-100"
              aria-label="Delete conversation"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
