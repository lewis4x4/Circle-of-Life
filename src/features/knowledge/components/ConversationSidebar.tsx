"use client";

import React from "react";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import type { ChatConversationRow } from "../lib/types";

interface ConversationSidebarProps {
  conversations: ChatConversationRow[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
}: ConversationSidebarProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col border-r border-zinc-800/90 bg-zinc-950/50">
      <div className="shrink-0 border-b border-zinc-800/90 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors ${
              activeId === conv.id
                ? "border border-indigo-500/40 bg-indigo-950/50 ring-1 ring-indigo-500/20"
                : "cursor-pointer hover:bg-zinc-800/60"
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
            <MessageSquare className="h-4 w-4 shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{conv.title || "Untitled chat"}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="shrink-0 rounded-md p-1.5 opacity-0 transition hover:bg-red-950/50 group-hover:opacity-100"
              aria-label="Delete conversation"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
