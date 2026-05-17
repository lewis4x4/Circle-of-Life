"use client";

import React, { useRef, useEffect, useState } from "react";
import { X, Send, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHavenInsight } from "@/lib/haven-insight/HavenInsightContext";
import { Button } from "@/components/ui/button";

export function HavenInsightPanel() {
  const { isOpen, close, messages, currentModule, suggestedQuestions, loading, sendQuestion, clearChat } = useHavenInsight();
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    void sendQuestion(q);
  };

  return (
    <>
      {isOpen && <InsightBackdrop onClick={close} />}

      <div
        className={cn(
          "fixed top-0 right-0 z-[61] flex h-full w-full flex-col sm:w-[420px]",
          "border-l border-border bg-card shadow-[var(--shadow-card)]",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal={isOpen}
        aria-hidden={!isOpen}
        aria-label="Haven Insight"
      >
        <div className="flex items-start justify-between border-b border-border px-[13px] py-3">
          <div>
            <h2 className="text-lg font-medium text-foreground">Haven Insight</h2>
            <p className="text-sm text-muted-foreground">{currentModule.module}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={close} aria-label="Close Haven Insight">
            <X className="size-4" />
          </Button>
        </div>

        <div className="border-b border-border px-[13px] py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Focused on: <span className="normal-case font-medium text-foreground">{currentModule.perspective}</span>
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-[13px] py-3">
          {messages.length === 0 && (
            <InsightEmptyState
              moduleLabel={currentModule.module}
              suggestedQuestions={suggestedQuestions}
              loading={loading}
              sendQuestion={sendQuestion}
            />
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[300px] rounded-[9px] border px-[11px] py-2 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "border-border bg-muted/40 text-foreground"
                    : "border-border bg-background text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.tokensUsed != null && (
                  <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">{msg.tokensUsed} tokens</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="rounded-[9px] border border-border bg-background px-[11px] py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Analyzing…
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-border bg-card px-[13px] py-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Ask Haven Insight about your data"
              placeholder="Ask about your data…"
              disabled={loading}
              className="flex-1 rounded-[8px] border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              disabled={loading || !input.trim()}
              aria-label="Send question"
            >
              <Send className="size-3.5 text-muted-foreground" />
            </Button>
          </form>
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={clearChat}
              className="flex items-center gap-1 text-[9px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-2.5" /> Clear
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function InsightBackdrop({ onClick }: { onClick: () => void }) {
  return <div className="fixed inset-0 z-[60] bg-[color:var(--overlay)] lg:hidden" onClick={onClick} aria-hidden />;
}

function InsightEmptyState({
  moduleLabel,
  suggestedQuestions,
  loading,
  sendQuestion,
}: {
  moduleLabel: string;
  suggestedQuestions: string[];
  loading: boolean;
  sendQuestion: (text: string) => Promise<void>;
}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-[8px] border border-border bg-card px-[13px] py-3">
        <p className="text-sm text-muted-foreground">Ask anything about your {moduleLabel.toLowerCase()} data.</p>
      </div>
      <div>
        <p className="mb-1 border-t border-border pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Example questions
        </p>
        <ul className="space-y-1">
          {suggestedQuestions.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => void sendQuestion(q)}
                disabled={loading}
                className="min-h-[33px] w-full rounded-[8px] border border-border bg-background px-[11px] py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
