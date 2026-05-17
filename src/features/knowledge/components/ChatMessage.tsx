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
                {sources.map((s, i) => {
                  const href = s.anchor?.href ?? null;
                  const compliance = s.anchor?.compliance_category ?? null;
                  const regCite = s.anchor?.regulation_citation ?? null;
                  const page = s.anchor?.page_number ?? null;
                  // KB-NEXT-10: render the source card as a link when we have
                  // a document anchor, so users can click through to verify
                  // the cited chunk. Fall back to a static card pre-NEXT-06.
                  const card = (
                    <div className="rounded-[8px] border border-border bg-background p-2 hover:bg-muted/40 transition-colors">
                      <div className="text-xs font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                        <span>{s.title}</span>
                        {compliance ? (
                          <span className="text-[10px] rounded border border-border px-1 py-px text-muted-foreground">
                            {compliance}
                          </span>
                        ) : null}
                        {regCite ? (
                          <span className="text-[10px] rounded border border-border px-1 py-px text-muted-foreground">
                            {regCite}
                          </span>
                        ) : null}
                      </div>
                      {s.section_title || page != null ? (
                        <div className="text-[10px] text-muted-foreground">
                          {s.section_title ?? ""}
                          {s.section_title && page != null ? " · " : ""}
                          {page != null ? `page ${page}` : ""}
                        </div>
                      ) : null}
                      <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {s.excerpt}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{Math.round(s.confidence * 100)}% match</span>
                        {href ? <span className="text-primary">open ↗</span> : null}
                      </div>
                    </div>
                  );
                  return (
                    <div key={i}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block no-underline"
                        >
                          {card}
                        </a>
                      ) : (
                        card
                      )}
                    </div>
                  );
                })}
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
