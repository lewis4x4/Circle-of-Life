"use client";

import React, { useRef, useEffect, useState } from "react";
import { X, MessageSquare, Send, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHavenInsight } from "@/lib/haven-insight/HavenInsightContext";

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
      {/* Backdrop */}
      {isOpen && <div className="fixed inset-0 z-[60] bg-[color:var(--overlay)] lg:hidden" onClick={close} />}

      {/* Panel */}
      <div className={cn(
        "fixed top-0 right-0 h-full w-full sm:w-[420px] z-[61] flex flex-col",
        "bg-card border-l border-border shadow-[var(--shadow-card)]",
        "transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "translate-x-full",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-sm font-medium text-foreground">Haven Insight</h2>
              <p className="text-[11px] text-muted-foreground">{currentModule.module}</p>
            </div>
          </div>
          <button onClick={close} className="grid size-8 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context Badge */}
        <div className="border-b border-border px-5 py-2">
          <p className="text-[11px] text-muted-foreground">
            Focused on: <span className="font-medium text-foreground">{currentModule.perspective}</span>
          </p>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-4 pt-4">
              <p className="text-center text-xs text-muted-foreground">Ask anything about your {currentModule.module.toLowerCase()} data</p>
              <div className="space-y-1">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => void sendQuestion(q)}
                    disabled={loading}
                    className="min-h-[33px] w-full rounded-[8px] border border-border bg-background px-[11px] py-2 text-left text-xs text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "")}>
              {msg.role === "assistant" && (
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background">
                  <MessageSquare className="size-3 text-muted-foreground" />
                </div>
              )}
              <div className={cn(
                "max-w-[300px] rounded-[9px] border px-[13px] py-2.5 text-xs leading-relaxed",
                msg.role === "user"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground"
              )}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.tokensUsed && <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">{msg.tokensUsed} tokens</p>}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background">
                <MessageSquare className="size-3 text-muted-foreground" />
              </div>
              <div className="rounded-[9px] border border-border bg-background px-[13px] py-2.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin text-primary" /> Analyzing...
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="border-t border-border bg-card px-4 py-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Ask Haven Insight about your data"
              placeholder="Ask about your data..."
              disabled={loading}
              className="flex-1 rounded-[8px] border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-[8px] bg-primary px-3 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
          <div className="flex justify-center mt-2">
            <button onClick={clearChat} className="flex items-center gap-1 text-[9px] text-muted-foreground transition-colors hover:text-foreground">
              <RotateCcw className="w-2.5 h-2.5" /> Clear
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
