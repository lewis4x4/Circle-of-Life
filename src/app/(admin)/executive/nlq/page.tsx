"use client";

/**
 * Haven Insight — AI-powered executive Q&A
 *
 * Executives can ask questions about their ALF portfolio in plain English
 * and get AI-powered answers from Haven data.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { Send, Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
import { HavenInsightChart, type ChartSpec } from "@/components/haven-insight/HavenInsightChart";
import { InsightFeedback } from "@/components/haven-insight/InsightFeedback";

// ── Types ──

interface NlqMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tokensUsed?: number;
  citations?: Array<{
    label: string;
    href?: string;
    facility_id?: string;
    kind?: "facility" | "report" | "kb" | "metric";
  }>;
  intent?: string;
  toolsUsed?: string[];
  fallbackUsed?: boolean;
  followUpSuggestions?: string[];
  chartSpec?: ChartSpec | null;
}

type RouterPayload = Record<string, unknown>;

type SlashTemplate = {
  label: string;
  query: string;
};

// ── Suggested questions ──

const SUGGESTED_QUESTIONS = [
  "What's our current occupancy across all facilities?",
  "Which facility has the most open incidents?",
  "How does our AR aging look right now?",
  "Are there any active infection outbreaks?",
  "Which staff certifications are expiring soon?",
  "What's our overall compliance status?",
];

const SLASH_TEMPLATES: SlashTemplate[] = [
  { label: "Compare facilities by [metric]", query: "Compare facilities by occupancy" },
  { label: "Trend last 30 days for [metric]", query: "Trend last 30 days for incidents" },
  { label: "Compliance scorecard", query: "Show compliance scorecard for all facilities" },
  { label: "Cost outliers", query: "Which facilities are cost outliers this month" },
  { label: "Top exceptions", query: "What are the top open exceptions across the portfolio" },
];

// ── Main Component ──

const MAX_MESSAGES = 50;
const NLQ_ROUTE = "/admin/executive/nlq";
const NLQ_MODULE = "executive";

function formatErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Rate limit
  if (/rate limit/i.test(msg) || /429/.test(msg)) {
    return "Haven Insight is processing several requests. Try again in a minute.";
  }
  // Auth
  if (/unauthorized|401|session/i.test(msg)) {
    return "Your session expired. Please refresh the page and sign in again.";
  }
  // Timeout
  if (/timeout|aborted/i.test(msg)) {
    return "That question took longer than expected. Try narrowing the scope (e.g. one facility or one metric).";
  }
  // Generic
  return "I couldn't process that question right now. Please try again or rephrase.";
}

function normalizeCitations(citations: unknown): NlqMessage["citations"] {
  if (!Array.isArray(citations)) return undefined;

  type NlqCitation = NonNullable<NlqMessage["citations"]>[number];
  const normalized = citations.flatMap((citation): NlqCitation[] => {
    if (!citation || typeof citation !== "object") return [];
    const record = citation as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : "";
    if (!label) return [];

    const rawKind = record.kind;
    const kind: NlqCitation["kind"] = rawKind === "facility" || rawKind === "report" || rawKind === "kb" || rawKind === "metric" ? rawKind : undefined;
    return [{
      label,
      href: typeof record.href === "string" ? record.href : undefined,
      facility_id: typeof record.facility_id === "string" ? record.facility_id : undefined,
      kind,
    }];
  });

  return normalized.length ? normalized : undefined;
}

function normalizeStringArray(value: unknown, limit?: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const limited = typeof limit === "number" ? normalized.slice(0, limit) : normalized;
  return limited.length ? limited : undefined;
}

function normalizeChartSpec(value: unknown): ChartSpec | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "bar" && kind !== "line" && kind !== "pie") return null;
  if (!Array.isArray(record.series)) return null;

  const series = record.series.flatMap((item): ChartSpec["series"] => {
    if (!item || typeof item !== "object") return [];
    const point = item as Record<string, unknown>;
    const label = typeof point.label === "string" ? point.label : "";
    const value = typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
    return label && value !== null ? [{ label, value }] : [];
  });

  return series.length ? { kind, series } : null;
}

function assistantMessageFromPayload(payload: RouterPayload, fallbackId: string): NlqMessage {
  return {
    id: typeof payload.session_id === "string" ? payload.session_id : fallbackId,
    role: "assistant",
    content: typeof payload.answer === "string" && payload.answer.length > 0 ? payload.answer : "No response generated.",
    timestamp: new Date(),
    tokensUsed: typeof payload.tokens_used === "number" ? payload.tokens_used : undefined,
    citations: normalizeCitations(payload.citations),
    intent: typeof payload.intent === "string" ? payload.intent : undefined,
    toolsUsed: normalizeStringArray(payload.tools_used),
    fallbackUsed: payload.fallback_used === true,
    followUpSuggestions: normalizeStringArray(payload.follow_up_suggestions, 3),
    chartSpec: normalizeChartSpec(payload.chart_spec),
  };
}

export default function ExecutiveNlqPage() {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<NlqMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [canUse, setCanUse] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Cmd+K / Ctrl+K focuses the question input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Slash palette state follows the first character of the input.
  useEffect(() => {
    if (input.startsWith("/") && !loading) {
      setPaletteOpen(true);
      return;
    }

    setPaletteOpen(false);
    setPaletteIndex(0);
  }, [input, loading]);

  const fillSlashTemplate = useCallback((template: SlashTemplate) => {
    setInput(template.query);
    setPaletteOpen(false);
    setPaletteIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Send question
  const sendQuestion = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;

    setInput("");
    setPaletteOpen(false);
    setPaletteIndex(0);

    // Add user message
    const userMsg: NlqMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), userMsg]);
    setLoading(true);
    setAwaitingFirstToken(true);

    const body = JSON.stringify({
      question: q,
      route: NLQ_ROUTE,
      module: NLQ_MODULE,
    });
    let assistantId = `ai-${Date.now()}`;
    let hasAssistantMessage = false;
    let shouldRetryJson = true;

    const appendAssistantToken = (content: string) => {
      if (!content) return;
      setAwaitingFirstToken(false);

      if (!hasAssistantMessage) {
        hasAssistantMessage = true;
        setMessages(prev => [
          ...prev.slice(-MAX_MESSAGES + 1),
          {
            id: assistantId,
            role: "assistant",
            content,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setMessages(prev => prev.map((msg) => (
        msg.id === assistantId ? { ...msg, content: `${msg.content}${content}` } : msg
      )));
    };

    const applyAssistantMeta = (payload: RouterPayload) => {
      setAwaitingFirstToken(false);
      const nextId = typeof payload.session_id === "string" ? payload.session_id : assistantId;
      const meta = {
        tokensUsed: typeof payload.tokens_used === "number" ? payload.tokens_used : undefined,
        citations: normalizeCitations(payload.citations),
        intent: typeof payload.intent === "string" ? payload.intent : undefined,
        toolsUsed: normalizeStringArray(payload.tools_used),
        fallbackUsed: payload.fallback_used === true,
        followUpSuggestions: normalizeStringArray(payload.follow_up_suggestions, 3),
        chartSpec: normalizeChartSpec(payload.chart_spec),
      } satisfies Partial<NlqMessage>;

      setMessages(prev => {
        let updated = false;
        const next = prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          updated = true;
          return {
            ...msg,
            id: nextId,
            content: msg.content || "No response generated.",
            ...meta,
          };
        });

        if (updated) return next;
        hasAssistantMessage = true;
        return [
          ...prev.slice(-MAX_MESSAGES + 1),
          {
            id: nextId,
            role: "assistant",
            content: "No response generated.",
            timestamp: new Date(),
            ...meta,
          },
        ];
      });
      assistantId = nextId;
    };

    const appendJsonAssistant = (payload: RouterPayload) => {
      const assistantMsg = assistantMessageFromPayload(payload, assistantId);
      setAwaitingFirstToken(false);
      hasAssistantMessage = true;
      assistantId = assistantMsg.id;
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), assistantMsg]);
    };

    const requestRouter = (stream: boolean) => authorizedEdgeFetch("haven-ai-router", {
      method: "POST",
      headers: {
        Accept: stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
      },
      body,
    }, "haven-insight");

    const fetchJsonAnswer = async () => {
      const res = await requestRouter(false);
      const data = await res.json() as RouterPayload;

      if (!res.ok || data.ok === false) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to get response");
      }

      appendJsonAssistant(data);
    };

    const handleSseEvent = (eventText: string): boolean => {
      const data = eventText
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (!data) return false;
      if (data === "[DONE]") return true;

      const payload = JSON.parse(data) as RouterPayload;
      if (payload.type === "token" && typeof payload.content === "string") {
        appendAssistantToken(payload.content);
        return false;
      }

      if (payload.type === "meta") {
        applyAssistantMeta(payload);
      }

      return false;
    };

    const streamAnswer = async () => {
      const res = await requestRouter(true);
      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        if (res.status !== 415) {
          shouldRetryJson = false;
          const data = await res.json().catch(() => null) as RouterPayload | null;
          throw new Error(data && typeof data.error === "string" ? data.error : `Failed to get response (${res.status})`);
        }
        throw new Error(`Streaming unavailable (${res.status})`);
      }

      if (!contentType.includes("text/event-stream")) {
        const data = await res.json() as RouterPayload;
        if (data.ok === false) {
          shouldRetryJson = false;
          throw new Error(typeof data.error === "string" ? data.error : "Failed to get response");
        }
        appendJsonAssistant(data);
        return;
      }

      if (!res.body) {
        throw new Error("Streaming response did not include a readable body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

      while (!streamDone) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const eventText = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (handleSseEvent(eventText)) {
            streamDone = true;
            await reader.cancel();
            break;
          }
          boundary = buffer.indexOf("\n\n");
        }
      }

      buffer += decoder.decode();
      if (!streamDone && buffer.trim()) {
        handleSseEvent(buffer);
      }
    };

    try {
      try {
        await streamAnswer();
      } catch (streamErr) {
        if (hasAssistantMessage || !shouldRetryJson) throw streamErr;
        await fetchJsonAnswer();
      }
    } catch (err) {
      const errMsg: NlqMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: formatErrorMessage(err),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), errMsg]);
    } finally {
      setLoading(false);
      setAwaitingFirstToken(false);
    }
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!paletteOpen) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPaletteIndex(prev => (prev + 1) % SLASH_TEMPLATES.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setPaletteIndex(prev => (prev - 1 + SLASH_TEMPLATES.length) % SLASH_TEMPLATES.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      fillSlashTemplate(SLASH_TEMPLATES[paletteIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPaletteOpen(false);
      setPaletteIndex(0);
    }
  };

  if (initialLoading) {
    return (
      <div className="relative min-h-dvh w-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!canUse) {
    return (
      <div className="relative min-h-dvh w-full flex items-center justify-center">
        <div className="text-center p-12">
          <p className="text-warning text-sm font-medium">Haven Insight is available to organization owners and org admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            Haven Insight
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Portfolio Q&A — natural-language answers grounded in your live operational data.
          </p>
        </div>
        <div className="hidden md:block">
          <ExecutiveHubNav />
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)] flex flex-col h-[calc(100dvh-220px)] min-h-[520px]">
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="mx-auto flex w-full max-w-2xl flex-col justify-center py-16">
                <h2 className="text-sm font-medium text-foreground">Ask Haven about your portfolio.</h2>
                <p className="max-w-md text-sm text-muted-foreground">Spans occupancy · revenue · incidents · compliance · staffing · any portfolio metric.</p>
                <p className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Try a question</p>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => void sendQuestion(q)}
                        className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-[11px] py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex max-w-3xl gap-3",
                  msg.role === "user" ? "ml-auto justify-end" : ""
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-card text-muted-foreground">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                )}
                <div className="flex max-w-[600px] flex-col gap-1.5">
                  {msg.role === "assistant" && msg.fallbackUsed === true && (
                    <p className="text-[11px] font-medium uppercase tracking-wider text-warning">Fallback model — answer may be less precise</p>
                  )}
                  <div className={cn(
                    "rounded-[var(--radius)] border px-[13px] py-3",
                    msg.role === "user"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground"
                  )}>
                    {msg.role === "assistant" && msg.chartSpec ? (
                      <HavenInsightChart spec={msg.chartSpec} className="mb-3" />
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                    {process.env.NODE_ENV === "development" && msg.tokensUsed && (
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">{msg.tokensUsed} tokens</p>
                    )}
                    {msg.role === "assistant" && msg.citations?.length ? (
                      <div className="mt-3 border-t border-border pt-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sources</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {msg.citations.map((citation, index) => {
                            const className = "inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
                            const key = `${citation.label}-${citation.href ?? citation.facility_id ?? index}`;
                            return citation.href ? (
                              <Link key={key} href={citation.href} className={className}>
                                {citation.label}
                              </Link>
                            ) : (
                              <span key={key} className={className}>
                                {citation.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {msg.role === "assistant" && msg.id.length === 36 ? (
                      <InsightFeedback sessionId={msg.id} />
                    ) : null}
                  </div>
                  {msg.role === "assistant" && msg.followUpSuggestions?.length ? (
                    <div className="pl-0.5">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Follow-up</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {msg.followUpSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => void sendQuestion(suggestion)}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-secondary/40 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            {loading && awaitingFirstToken && (
              <div className="flex gap-3 max-w-3xl">
                <div className="size-8 rounded-[var(--radius)] border border-border bg-card flex items-center justify-center shrink-0 text-muted-foreground">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div className="rounded-[var(--radius)] px-[13px] py-3 bg-card border border-border">
                  <div className="flex items-center gap-1" aria-label="Haven Insight is typing">
                    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <form onSubmit={handleSubmit} className="relative mx-auto flex max-w-3xl gap-3">
            {paletteOpen && (
              <div className="absolute bottom-full left-0 right-20 z-10 mb-2 overflow-hidden rounded-[var(--radius)] border border-border bg-popover shadow-[var(--shadow-lift)]">
                <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Templates</div>
                <div className="p-1.5">
                  {SLASH_TEMPLATES.map((template, index) => (
                    <button
                      key={template.label}
                      type="button"
                      onMouseEnter={() => setPaletteIndex(index)}
                      onClick={() => fillSlashTemplate(template)}
                      className={cn(
                        "flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors",
                        index === paletteIndex ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      )}
                    >
                      <span className="text-[13px] font-medium">{template.label}</span>
                      <span className="text-[11px] text-muted-foreground">{template.query}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Ask about your portfolio…  ⌘K"
              disabled={loading}
              className="flex-1 rounded-[var(--radius)] border border-input bg-background px-[13px] py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-[var(--radius)] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Ask
            </button>
          </form>
          {messages.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-3">
              <button
                onClick={() => setMessages([])}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Clear conversation
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
