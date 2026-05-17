"use client";

/**
 * Haven Insight — AI-powered executive Q&A
 *
 * Executives can ask questions about their ALF portfolio in plain English
 * and get AI-powered answers from Haven data.
 */

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { Send, Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";

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
        <></>
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!canUse) {
    return (
      <div className="relative min-h-[calc(100vh-64px)] w-full flex items-center justify-center">
        <></>
        <div className="text-center p-12">
          <p className="text-warning text-sm font-medium">Haven Insight is available to organization owners and org admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] w-full flex-col">
      <RecordDetailHeader
        title="Haven Insight"
        subtitle="Ask questions about your portfolio in plain English"
        backLink={{ href: "/admin/executive", label: "Back to Executive Overview" }}
        className="[&_h1]:text-lg [&_h1]:font-medium"
      />

      <RecordDetailSection title="Portfolio Q&A" className="flex min-h-[620px] flex-1 flex-col p-0">
        <div className="flex-1 overflow-y-auto px-[14px] py-[14px] space-y-4">
          {messages.length === 0 && (
            <div className="mx-auto flex w-full max-w-2xl flex-col justify-center py-16">
              <div className="rounded-[8px] border border-border bg-card p-[14px] shadow-[var(--shadow-card)]">
                <h2 className="text-sm font-medium text-foreground">What would you like to know?</h2>
                <p className="text-sm text-muted-foreground max-w-md">Ask about occupancy, revenue, incidents, compliance, staffing, or any portfolio metric.</p>
                <ul className="mt-4 grid gap-1.5">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => void sendQuestion(q)}
                        className="min-h-[33px] w-full rounded-[8px] border border-border bg-background px-[11px] py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
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
                "w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 border",
                msg.role === "user"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground"
              )}>
                {msg.role === "user" ? "You" : <MessageSquare className="w-4 h-4" />}
              </div>
              <div className={cn(
                "rounded-[9px] border px-[13px] py-3 max-w-[600px]",
                msg.role === "user"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground"
              )}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                {msg.tokensUsed && (
                  <p className="text-[10px] text-muted-foreground mt-2 font-mono">{msg.tokensUsed} tokens</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 max-w-3xl">
              <div className="w-8 h-8 rounded-[8px] border border-border bg-card flex items-center justify-center shrink-0 text-muted-foreground">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="rounded-[9px] px-[13px] py-3 bg-card border border-border">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing your portfolio data...
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-border bg-card px-[14px] py-[14px]">
          {error && (
            <p className="text-xs text-destructive mb-2">{error}</p>
          )}
          <form onSubmit={handleSubmit} className="flex gap-3 max-w-3xl mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your portfolio..."
              disabled={loading}
              className="flex-1 rounded-[8px] border border-input bg-background px-[13px] py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-[8px] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Ask
            </button>
          </form>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              onClick={() => setMessages([])}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Clear conversation
            </button>
          </div>
        </div>
      </RecordDetailSection>
    </div>
  );
}
