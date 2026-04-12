"use client";

import React, { useRef, useEffect, useState } from "react";
import { X, Brain, Send, Loader2, RotateCcw, Sparkles } from "lucide-react";
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
      {isOpen && <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60] lg:hidden" onClick={close} />}

      {/* Panel */}
      <div className={cn(
        "fixed top-0 right-0 h-full w-full sm:w-[420px] z-[61] flex flex-col",
        "bg-slate-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl",
        "transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "translate-x-full",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Haven Insight</h2>
              <p className="text-[10px] text-violet-400 font-medium">{currentModule.module}</p>
            </div>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context Badge */}
        <div className="px-5 py-2 border-b border-white/5 bg-violet-500/5">
          <p className="text-[10px] text-violet-400/80">
            <Sparkles className="w-3 h-3 inline mr-1" />
            Focused on: <span className="font-semibold text-violet-300">{currentModule.perspective}</span>
          </p>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-4 pt-4">
              <p className="text-xs text-slate-500 text-center">Ask anything about your {currentModule.module.toLowerCase()} data</p>
              <div className="space-y-2">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => void sendQuestion(q)}
                    disabled={loading}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all text-xs text-slate-300 hover:text-white disabled:opacity-50"
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
                <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Brain className="w-3 h-3 text-violet-400" />
                </div>
              )}
              <div className={cn(
                "rounded-xl px-3.5 py-2.5 max-w-[300px] text-xs leading-relaxed",
                msg.role === "user"
                  ? "bg-indigo-500/15 border border-indigo-500/20 text-slate-200"
                  : "bg-white/[0.03] border border-white/5 text-slate-200"
              )}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.tokensUsed && <p className="text-[9px] text-slate-600 mt-1.5 font-mono">{msg.tokensUsed} tokens</p>}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center shrink-0">
                <Brain className="w-3 h-3 text-violet-400 animate-pulse" />
              </div>
              <div className="rounded-xl px-3.5 py-2.5 bg-white/[0.03] border border-white/5">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="border-t border-white/5 px-4 py-3 bg-slate-950/50">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data..."
              disabled={loading}
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-3 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white disabled:opacity-40 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
          <div className="flex justify-center mt-2">
            <button onClick={clearChat} className="text-[9px] text-slate-600 hover:text-slate-300 transition-colors flex items-center gap-1">
              <RotateCcw className="w-2.5 h-2.5" /> Clear
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
