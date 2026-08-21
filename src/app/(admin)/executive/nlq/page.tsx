"use client";

/**
 * Haven Insight — AI-powered executive Q&A
 *
 * Executives can ask questions about their ALF portfolio in plain English
 * and get AI-powered answers from Haven data.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { Send, Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
import { HavenInsightChart, type ChartSpec } from "@/components/haven-insight/HavenInsightChart";
import { ConversationSidebar } from "@/components/haven-insight/ConversationSidebar";
import { InsightFeedback } from "@/components/haven-insight/InsightFeedback";
import { HavenErrorBoundary } from "@/components/common/HavenErrorBoundary";
import { Card, CardContent } from "@/components/ui/card";
import { resolveExecutiveOrganizationGapMessage } from "@/lib/executive/executive-auth-page-state";
import {
  EXECUTIVE_HAVEN_INSIGHT_EMPTY_STATE_HELPER,
  EXECUTIVE_HAVEN_INSIGHT_ROUTE_LOADING_MESSAGE,
} from "@/lib/executive/haven-insight-page-copy";
import type { Database } from "@/types/database";

// ── Types ──

interface NlqMessage {
  id: string;
  sessionId?: string;
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

type ExecNlqMessageRow = {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  follow_ups: unknown;
  chart_spec: unknown;
  fallback_used: boolean | null;
  tokens_used: number | null;
  created_at: string | null;
  session_id: string;
};

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

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

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
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
  return {
    id: typeof payload.message_id === "string" ? payload.message_id : fallbackId,
    sessionId,
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

function rowToNlqMessage(row: ExecNlqMessageRow): NlqMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    timestamp: row.created_at ? new Date(row.created_at) : new Date(),
    tokensUsed: typeof row.tokens_used === "number" ? row.tokens_used : undefined,
    citations: normalizeCitations(row.citations),
    fallbackUsed: row.fallback_used === true,
    followUpSuggestions: normalizeStringArray(row.follow_ups, 3),
    chartSpec: normalizeChartSpec(row.chart_spec),
  };
}

export default function ExecutiveNlqPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const activeSessionId = sessionParam;
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, appRole, loading: authLoading } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const canUse = role === "owner" || role === "org_admin";
  const [messages, setMessages] = useState<NlqMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendAbortRef = useRef<AbortController | null>(null);
  const syncedSessionRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: messages.length > 0,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      sendAbortRef.current?.abort();
      sendAbortRef.current = null;
    };
  }, []);

  // Hydrate persisted conversation messages when the URL session changes.
  useEffect(() => {
    if (!sessionParam) {
      // Don't wipe messages if we just locally synced this URL ourselves
      // (post-send URL update with no session_id). Only clear when we're
      // genuinely landing on the new-conversation route.
      if (syncedSessionRef.current === null) {
        setMessages([]);
      }
      return;
    }

    if (!organizationId) return;

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("exec_nlq_messages" as never)
        .select("id, role, content, ordinal, citations, follow_ups, chart_spec, fallback_used, tokens_used, created_at, session_id" as never)
        .eq("session_id" as never, sessionParam as never)
        .eq("organization_id" as never, organizationId as never)
        .neq("role" as never, "system" as never)
        .is("deleted_at" as never, null)
        .order("ordinal" as never, { ascending: true });

      if (cancelled) return;
      if (error) return;
      const rows = (data ?? []) as unknown as ExecNlqMessageRow[];
      // HOTFIX: when the DB has rows, hydrate. When it doesn't AND we
      // already have the same session's messages in local state (race after
      // we just streamed), don't wipe — keep what we have. When local state
      // is for a different session OR empty, accept the empty result.
      if (rows.length > 0) {
        setMessages(rows.map(rowToNlqMessage));
      } else if (syncedSessionRef.current !== sessionParam) {
        // Genuine empty thread the user navigated to from elsewhere.
        setMessages([]);
      }
    })();

    return () => {
      cancelled = true;
      if (syncedSessionRef.current === sessionParam) {
        syncedSessionRef.current = null;
      }
    };
  }, [organizationId, sessionParam, supabase]);

  const syncSessionUrl = useCallback((sessionId: string) => {
    if (sessionId.length !== 36) return;
    if (sessionId === syncedSessionRef.current || sessionId === sessionParam) return;
    syncedSessionRef.current = sessionId;
    router.replace(`${NLQ_ROUTE}?session=${sessionId}`, { scroll: false });
  }, [router, sessionParam]);

  // After a successful send, make the router-provided session_id the URL source of truth.
  // HOTFIX: depend on the last assistant message's sessionId so this fires when
  // the SSE meta event arrives and stamps the real UUID onto the placeholder.
  const lastAssistantSessionId =
    messages.length > 0 && messages[messages.length - 1]?.role === "assistant"
      ? messages[messages.length - 1]?.sessionId ?? null
      : null;
  useEffect(() => {
    if (!lastAssistantSessionId || lastAssistantSessionId.length !== 36) return;
    if (lastAssistantSessionId === syncedSessionRef.current || lastAssistantSessionId === sessionParam) return;
    syncedSessionRef.current = lastAssistantSessionId;
    router.replace(`/admin/executive/nlq?session=${lastAssistantSessionId}`, { scroll: false });
  }, [lastAssistantSessionId, sessionParam, router]);

  const startNewConversation = useCallback(() => {
    sendAbortRef.current?.abort();
    sendAbortRef.current = null;
    setLoading(false);
    setAwaitingFirstToken(false);
    // HOTFIX: explicitly reset the synced-session guard so the hydration effect
    // knows this is a genuine new-conversation reset (not a post-send URL sync).
    syncedSessionRef.current = null;
    router.replace(NLQ_ROUTE, { scroll: false });
    setMessages([]);
  }, [router]);

  // Cmd+K / Ctrl+K focuses the question input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const target = event.target;
      const isTextTarget = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      if (isTextTarget && target !== inputRef.current) return;

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
    if (!q || loadingRef.current) return;
    loadingRef.current = true;

    sendAbortRef.current?.abort();
    const abortController = new AbortController();
    sendAbortRef.current = abortController;

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
      session_id: activeSessionId ?? undefined,
    });
    let assistantId = `ai-${Date.now()}`;
    let hasAssistantMessage = false;
    let shouldRetryJson = true;

    const appendAssistantToken = (content: string) => {
      if (!content || sendAbortRef.current !== abortController) return;
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

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.id !== assistantId) return prev;
        return [...prev.slice(0, -1), { ...last, content: `${last.content}${content}` }];
      });
    };

    const applyAssistantMeta = (payload: RouterPayload) => {
      if (sendAbortRef.current !== abortController) return;
      setAwaitingFirstToken(false);
      const nextId = typeof payload.message_id === "string" ? payload.message_id : assistantId;
      const nextSessionId = typeof payload.session_id === "string" ? payload.session_id : undefined;
      const meta = {
        sessionId: nextSessionId,
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
      if (nextSessionId) syncSessionUrl(nextSessionId);
    };

    const appendJsonAssistant = (payload: RouterPayload) => {
      if (sendAbortRef.current !== abortController) return;
      const assistantMsg = assistantMessageFromPayload(payload, assistantId);
      setAwaitingFirstToken(false);
      hasAssistantMessage = true;
      assistantId = assistantMsg.id;
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), assistantMsg]);
      if (assistantMsg.sessionId) syncSessionUrl(assistantMsg.sessionId);
    };

    const requestRouter = (stream: boolean) => authorizedEdgeFetch("haven-ai-router", {
      method: "POST",
      headers: {
        Accept: stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
      },
      body,
      signal: abortController.signal,
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
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (isAbortError(err)) {
            streamDone = true;
            break;
          }
          throw err;
        }
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
        if (isAbortError(streamErr)) throw streamErr;
        if (hasAssistantMessage || !shouldRetryJson) throw streamErr;
        await fetchJsonAnswer();
      }
    } catch (err) {
      if (isAbortError(err) || sendAbortRef.current !== abortController) return;
      const errMsg: NlqMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: formatErrorMessage(err),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), errMsg]);
    } finally {
      if (sendAbortRef.current === abortController) {
        sendAbortRef.current = null;
        setLoading(false);
        setAwaitingFirstToken(false);
      }
      loadingRef.current = false;
    }
  }, [activeSessionId, syncSessionUrl]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  }, [input, sendQuestion]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
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
  }, [fillSlashTemplate, paletteIndex, paletteOpen]);

  if (authLoading) {
    return (
      <div
        className="relative flex min-h-dvh w-full items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {EXECUTIVE_HAVEN_INSIGHT_ROUTE_LOADING_MESSAGE}
        </div>
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

  if (organizationGapMessage) {
    return (
      <div className="relative flex min-h-dvh w-full items-center justify-center p-6">
        <Card className="max-w-lg rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            {organizationGapMessage}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    // HOTFIX: AppShell owns the scroll container, so pure flex sizing cannot
    // reliably derive the remaining viewport height here. Keep the parent
    // chain min-h-0, then use breakpoint-aware viewport math so the input stays
    // docked above the fold on mobile/tablet and desktop chrome. Mobile/tablet
    // subtracts the topbar, pillar strip, page header, gap, and shell padding.
    <div className="relative flex h-full w-full">
      <main className="flex h-full min-h-0 flex-1 flex-col gap-6 lg:pl-[var(--haven-sidebar-width,280px)]">
        <div className="flex flex-col gap-3 pt-11 md:flex-row md:items-start md:justify-between lg:pt-0">
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

        <div className="flex min-h-0 flex-none flex-col rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)] h-[calc(100dvh-252px)] lg:h-[calc(100dvh-176px)] 2xl:h-[calc(100dvh-192px)]">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="mx-auto flex w-full max-w-2xl flex-col justify-center py-16">
                <h2 className="text-sm font-medium text-foreground">Ask Haven about your portfolio.</h2>
                <p className="max-w-md text-sm text-muted-foreground">Spans occupancy · revenue · incidents · compliance · staffing · any portfolio metric.</p>
                <p className="mt-1 max-w-md text-[12px] text-muted-foreground">
                  {EXECUTIVE_HAVEN_INSIGHT_EMPTY_STATE_HELPER}
                </p>
                <p className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Try a question</p>
                <ul className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <li key={q} className="h-full">
                      <button
                        type="button"
                        onClick={() => void sendQuestion(q)}
                        className="flex h-full min-h-9 w-full items-center rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-left text-[13px] leading-snug text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <div className="flex min-w-0 max-w-[600px] flex-col gap-1.5">
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
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</p>
                    {process.env.NODE_ENV === "development" && msg.tokensUsed && (
                      <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">{msg.tokensUsed} tokens</p>
                    )}
                    {msg.role === "assistant" && msg.citations?.length ? (
                      <div className="mt-3 border-t border-border pt-2">
                        <h4 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Sources</h4>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {msg.citations.map((citation, index) => {
                            // P0-5: drop /50 opacity + bump text color so citation chip clears WCAG AA over the assistant bubble fill.
                            const className = "inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
                      <InsightFeedback messageId={msg.id} />
                    ) : null}
                  </div>
                  {msg.role === "assistant" && msg.followUpSuggestions?.length ? (
                    <div>
                      <p className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">Follow-up</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {msg.followUpSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => void sendQuestion(suggestion)}
                            // P0-5: same contrast bump on follow-up chips — solid secondary fill + foreground text.
                            className="inline-flex h-7 items-center rounded-md border border-border bg-secondary px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <div className="flex max-w-3xl gap-3" role="status" aria-live="polite">
                <span className="sr-only">Haven is thinking</span>
                <div className="size-8 rounded-[var(--radius)] border border-border bg-card flex items-center justify-center shrink-0 text-muted-foreground">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div className="rounded-[var(--radius)] px-[13px] py-3 bg-card border border-border">
                  <div className="flex items-center gap-1" aria-hidden="true">
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
              <div
                id="haven-slash-palette"
                role="listbox"
                aria-label="Slash templates"
                className="absolute bottom-full left-0 right-20 z-10 mb-2 overflow-hidden rounded-[var(--radius)] border border-border bg-popover shadow-[var(--shadow-lift)]"
              >
                <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Templates</div>
                <div className="p-1.5">
                  {SLASH_TEMPLATES.map((template, index) => (
                    <button
                      key={template.label}
                      type="button"
                      id={`palette-item-${index}`}
                      role="option"
                      aria-selected={index === paletteIndex}
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
              role="combobox"
              aria-expanded={paletteOpen}
              aria-controls={paletteOpen ? "haven-slash-palette" : undefined}
              aria-autocomplete="list"
              aria-activedescendant={paletteOpen ? `palette-item-${paletteIndex}` : undefined}
              placeholder="Ask about your portfolio…  ⌘K"
              disabled={loading}
              className="flex-1 rounded-[var(--radius)] border border-input bg-background px-[13px] py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label={loading ? "Sending question" : "Send question"}
              className="flex items-center gap-2 rounded-[var(--radius)] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {loading ? "Sending…" : "Ask"}
            </button>
          </form>
          {messages.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-3">
              <button
                onClick={startNewConversation}
                // P0-2: bump from 10px → 12px (12px floor) and add focus-visible ring for keyboard users.
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw className="w-3 h-3" /> Clear conversation
              </button>
            </div>
          )}
        </div>
        </div>
      </main>
      <HavenErrorBoundary
        fallback={(
          <div className="absolute inset-y-0 left-0 z-30 hidden w-[280px] items-center justify-center border-r border-border bg-card px-4 text-center text-[12px] text-muted-foreground lg:flex">
            Sidebar failed to load
          </div>
        )}
      >
        <ConversationSidebar currentSessionId={activeSessionId} onNewConversation={startNewConversation} />
      </HavenErrorBoundary>
    </div>
  );
}
