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
    <div className="flex flex-col h-full border-r border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50">
      <div className="p-3 border-b border-slate-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-2 w-full rounded-xl bg-indigo-600 text-white px-3 py-2.5 text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
              activeId === conv.id
                ? "bg-white dark:bg-zinc-800 shadow-sm border border-slate-200 dark:border-zinc-700"
                : "hover:bg-white/60 dark:hover:bg-zinc-800/40"
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
          >
            <MessageSquare className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-700 dark:text-zinc-300 truncate flex-1">
              {conv.title || "Untitled chat"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conv.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
