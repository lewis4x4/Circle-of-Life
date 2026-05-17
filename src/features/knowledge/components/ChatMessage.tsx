"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentFeedback(feedback);
  }, [feedback]);

  const handleFeedback = useCallback(
    async (value: "positive" | "negative") => {
      if (!id) return;
      setFeedbackError(null);
      const supabase = createClient();
      const newVal = currentFeedback === value ? null : value;
      const { error } = await supabase.from("chat_messages").update({ feedback: newVal }).eq("id", id);
      if (error) {
        setFeedbackError(error.message);
        return;
      }
      setCurrentFeedback(newVal);
    },
    [id, currentFeedback],
  );

  return (
    <div className={`flex gap-3 ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-[9px] border px-[13px] py-3 ${
          role === "user"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground"
        }`}
      >
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{content}</div>

        {isStreaming && <span className="inline-block ml-0.5 h-4 w-2 animate-pulse rounded-sm bg-primary" />}

        {role === "assistant" && sources && sources.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setShowSources(!showSources)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
                    className="rounded-[8px] border border-border bg-background p-2"
                  >
                    <div className="text-xs font-medium text-foreground">{s.title}</div>
                    {s.section_title && <div className="text-[10px] text-muted-foreground">{s.section_title}</div>}
                    <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{s.excerpt}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{Math.round(s.confidence * 100)}% match</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {role === "assistant" && !isStreaming && id && (
          <div className="flex flex-col gap-1 mt-2 pt-1">
            {feedbackError && (
              <div className="text-[10px] text-warning">{feedbackError}</div>
            )}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => void handleFeedback("positive")}
                className={`rounded p-1 transition-colors ${currentFeedback === "positive" ? "text-success" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleFeedback("negative")}
                className={`rounded p-1 transition-colors ${currentFeedback === "negative" ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
