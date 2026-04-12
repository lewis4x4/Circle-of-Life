"use client";

/**
 * Haven Insight — AI-powered executive Q&A
 *
 * Executives can ask questions about their ALF portfolio in plain English
 * and get AI-powered answers from Haven data.
 */

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Loader2, Brain, Sparkles, MessageSquare, RotateCcw } from "lucide-react";
import { SysLabel, TitleH1, Subtitle } from "@/components/ui/moonshot/typography";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";

// ── Types ──

interface NlqMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tokensUsed?: number;
}

// ── Suggested questions ──

const SUGGESTED_QUESTIONS = [
  "What's our current occupancy across all facilities?",
  "Which facility has the most open incidents?",
  "How does our AR aging look right now?",
  "Are there any active infection outbreaks?",
  "Which staff certifications are expiring soon?",
  "What's our overall compliance status?",
];

// ── Main Component ──

const MAX_MESSAGES = 50;

export default function ExecutiveNlqPage() {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<NlqMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canUse, setCanUse] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Check auth on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const ctx = await loadFinanceRoleContext(supabase);
        if (ctx.ok) {
          const allowed = ctx.ctx.appRole === "owner" || ctx.ctx.appRole === "org_admin";
          setCanUse(allowed);
        }
      } catch {
        // ignore
      } finally {
        setInitialLoading(false);
      }
    }
    void checkAuth();
  }, [supabase]);

  // Send question
  const sendQuestion = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;

    setError(null);
    setInput("");

    // Add user message
    const userMsg: NlqMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), userMsg]);
    setLoading(true);

    try {
      const res = await authorizedEdgeFetch("exec-nlq-executor", {
        method: "POST",
        body: JSON.stringify({ question: q }),
      }, "exec-nlq");

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      const assistantMsg: NlqMessage = {
        id: data.session_id || `ai-${Date.now()}`,
        role: "assistant",
        content: data.answer || "No response generated.",
        timestamp: new Date(),
        tokensUsed: data.tokens_used,
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), assistantMsg]);
    } catch (err) {
      const errMsg: NlqMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `I couldn't process that question right now. ${err instanceof Error ? err.message : "Please try again."}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), errMsg]);
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  if (initialLoading) {
    return (
      <div className="relative min-h-[calc(100vh-64px)] w-full flex items-center justify-center">
        <AmbientMatrix />
        <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!canUse) {
    return (
      <div className="relative min-h-[calc(100vh-64px)] w-full flex items-center justify-center">
        <AmbientMatrix />
        <div className="text-center p-12">
          <p className="text-amber-400 text-sm font-medium">Haven Insight is available to organization owners and org admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full flex flex-col">
      <AmbientMatrix primaryClass="bg-violet-900/10" secondaryClass="bg-indigo-900/10" />

      <div className="relative z-10 flex flex-col flex-1">
        {/* Header */}
        <header className="px-6 sm:px-12 py-6 border-b border-white/5">
          <Link href="/admin/executive" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Executive Overview
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <TitleH1>Haven Insight</TitleH1>
              <Subtitle>Ask questions about your portfolio in plain English</Subtitle>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-12 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 space-y-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-violet-400" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-semibold text-white">What would you like to know?</h2>
                <p className="text-sm text-slate-400 max-w-md">Ask about occupancy, revenue, incidents, compliance, staffing, or any portfolio metric.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => void sendQuestion(q)}
                    className="text-left px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all text-sm text-slate-300 hover:text-white"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-violet-400 inline mr-2" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 max-w-3xl",
                msg.role === "user" ? "ml-auto flex-row-reverse" : ""
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                msg.role === "user"
                  ? "bg-indigo-500/20 text-indigo-400"
                  : "bg-violet-500/20 text-violet-400"
              )}>
                {msg.role === "user" ? "You" : <Brain className="w-4 h-4" />}
              </div>
              <div className={cn(
                "rounded-2xl px-5 py-3 max-w-[600px]",
                msg.role === "user"
                  ? "bg-indigo-500/10 border border-indigo-500/20 text-slate-200"
                  : "bg-white/[0.03] border border-white/5 text-slate-200"
              )}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                {msg.tokensUsed && (
                  <p className="text-[10px] text-slate-500 mt-2 font-mono">{msg.tokensUsed} tokens</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 max-w-3xl">
              <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
                <Brain className="w-4 h-4 text-violet-400 animate-pulse" />
              </div>
              <div className="rounded-2xl px-5 py-3 bg-white/[0.03] border border-white/5">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing your portfolio data...
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="border-t border-white/5 bg-slate-900/80 backdrop-blur-xl px-6 sm:px-12 py-4">
          {error && (
            <p className="text-xs text-rose-400 mb-2">{error}</p>
          )}
          <form onSubmit={handleSubmit} className="flex gap-3 max-w-3xl mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your portfolio..."
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-500 hover:to-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-violet-500/20"
            >
              <Send className="w-4 h-4" />
              Ask
            </button>
          </form>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              onClick={() => setMessages([])}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Clear conversation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
