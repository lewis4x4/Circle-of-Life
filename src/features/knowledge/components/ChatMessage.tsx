"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { KBSource } from "../lib/types";
import { createClient } from "@/lib/supabase/client";

interface ChatMessageProps {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: KBSource[];
  feedback?: string | null;
  isStreaming?: boolean;
}

export function ChatMessage({ id, role, content, sources, feedback, isStreaming }: ChatMessageProps) {
  const [currentFeedback, setCurrentFeedback] = useState(feedback);
  const [showSources, setShowSources] = useState(false);

  const handleFeedback = async (value: "positive" | "negative") => {
    if (!id) return;
    const supabase = createClient();
    const newVal = currentFeedback === value ? null : value;
    await supabase.from("chat_messages").update({ feedback: newVal }).eq("id", id);
    setCurrentFeedback(newVal);
  };

  return (
    <div className={`flex gap-3 ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          role === "user"
            ? "bg-indigo-600 text-white"
            : "bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-slate-100"
        }`}
      >
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{content}</div>

        {isStreaming && <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse rounded-sm ml-0.5" />}

        {role === "assistant" && sources && sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setShowSources(!showSources)}
              className="flex items-center gap-1 text-xs text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
            >
              <FileText className="w-3 h-3" />
              {sources.length} source{sources.length !== 1 ? "s" : ""}
              {showSources ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showSources && (
              <div className="mt-2 space-y-2">
                {sources.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 p-2"
                  >
                    <div className="text-xs font-medium text-slate-700 dark:text-zinc-300">{s.title}</div>
                    {s.section_title && <div className="text-[10px] text-slate-400">{s.section_title}</div>}
                    <div className="text-xs text-slate-500 dark:text-zinc-400 mt-1 line-clamp-3">{s.excerpt}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{Math.round(s.confidence * 100)}% match</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {role === "assistant" && !isStreaming && id && (
          <div className="flex gap-1 mt-2 pt-1">
            <button
              type="button"
              onClick={() => void handleFeedback("positive")}
              className={`p-1 rounded transition-colors ${currentFeedback === "positive" ? "text-green-500" : "text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300"}`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleFeedback("negative")}
              className={`p-1 rounded transition-colors ${currentFeedback === "negative" ? "text-red-500" : "text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300"}`}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
