/**
 * haven-ai-router — unified AI entrypoint (KB-NEXT-01).
 *
 * Classifies the operator's question via a Claude-Haiku intent classifier,
 * then dispatches to the right backend (KPI bundle, facility fact-pack,
 * KB retrieval, or PHI-gated stub). One ai_invocations audit row per
 * invocation. One exec_nlq_sessions row so Haven Insight history is
 * seamless after the cutover.
 *
 * POST body:
 *   { question, session_id?, route?, module?, facility_id?, role? }
 *
 * Query params:
 *   ?dry_run=intent_only — skip dispatch + audit; return only classification.
 *     Used by tests/ai-router/intent-test-set.json + the eval script.
 *
 * Headers:
 *   X-Router-Failure: true   — on internal error; frontend may fall back to exec-nlq-executor.
 */

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { isOrgRateLimited, isRateLimited } from "../_shared/rate-limit.ts";
import { captureException, captureMessage } from "../_shared/sentry-edge.ts";
import {
  classifyIntent,
  intentCache,
  type IntentClassification,
  normalizeQuestion,
} from "../_shared/router-intent.ts";
import { dispatch, type DispatchResult } from "../_shared/router-dispatch.ts";
import {
  type ConversationContext,
  loadConversationContext,
  renderConversationHistory,
} from "../_shared/router-context.ts";

/* ------------------------------------------------------------------ */
/*  Per-token pricing (Sonnet 4.5) — used for token-budget accounting */
/* ------------------------------------------------------------------ */

const SONNET_INPUT_USD_PER_TOKEN = 0.000003; // $3 / 1M input tokens
const SONNET_OUTPUT_USD_PER_TOKEN = 0.000015; // $15 / 1M output tokens
const PER_QUESTION_RESERVATION_USD = 0.05; // conservative pre-flight reservation

/* ------------------------------------------------------------------ */
/*  Env                                                               */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROUTER_MODEL_LABEL = "haven-ai-router";
const SONNET_MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5";
const ANTHROPIC_TIMEOUT_MS = 60_000;
const MAX_STREAM_ANSWER_TOKENS = 1200;

const ALLOWED_ROLES = [
  "owner",
  "org_admin",
  "clinical_admin",
  "administrator",
  "clinical",
  "caregiver",
  "family",
];

const SPECULATIVE_DISPATCH_THRESHOLD = 0.7;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type RequestBody = {
  question?: string;
  session_id?: string;
  route?: string;
  module?: string;
  facility_id?: string;
  role?: string;
};

type ChartKind = "bar" | "line" | "pie";

type ChartSpec = {
  kind: ChartKind;
  series: Array<{ label: string; value: number }>;
  x_label?: string;
  y_label?: string;
};

type ParsedAnswerMetadata = {
  answer: string;
  followUpSuggestions: string[];
  chartSpec: ChartSpec | null;
  threadTitle: string | null;
};

type RouterLogger = {
  log: (payload: Record<string, unknown>) => void;
};

type PersistRouterResponseArgs = {
  admin: SupabaseClient;
  t: RouterLogger;
  bodySessionId: string | null;
  organizationId: string;
  userId: string;
  question: string;
  routeContext: string | null;
  moduleContext: string | null;
  intent: IntentClassification;
  dispatchResult: DispatchResult;
  primaryIntentOnlyWhenSpeculative: boolean;
  parsedAnswerMetadata: ParsedAnswerMetadata;
  streamed: boolean;
  shouldAutoTitle: boolean;
};

type StreamFinalAnswerResult = {
  rawAnswer: string;
  tokensIn: number;
  tokensOut: number;
  ok: boolean;
};

type PersistRouterResponseResult = {
  sessionId: string | null;
  messageCount: number;
  rollingSummaryText: string | null;
  rollingSummaryUpdatedAt: string | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponseWithHeader(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function routerFailureResponse(
  origin: string | null,
  message: string,
  status = 500,
): Response {
  return jsonResponseWithHeader(
    { ok: false, error: message },
    status,
    origin,
    { "X-Router-Failure": "true" },
  );
}

function wantsSse(req: Request): boolean {
  const accept = req.headers.get("accept")?.toLowerCase() ?? "";
  return accept.split(",").some((part) =>
    part.trim().startsWith("text/event-stream")
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function extractXmlBlock(
  text: string,
  tag: "follow_ups" | "chart" | "thread_title",
): string | null {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = pattern.exec(text);
  return typeof match?.[1] === "string" ? match[1].trim() : null;
}

function stripMetadataBlocks(text: string): string {
  return text
    .replace(/<follow_ups>[\s\S]*?<\/follow_ups>/gi, "")
    .replace(/<chart>[\s\S]*?<\/chart>/gi, "")
    .replace(/<thread_title>[\s\S]*?<\/thread_title>/gi, "")
    .trim();
}

function normalizeSuggestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length <= 80 ? trimmed : trimmed.slice(0, 79).trimEnd() + "…";
}

function parseFollowUpSuggestions(block: string | null): string[] {
  if (!block) return [];
  const parsed = parseJsonObject(block);
  const suggestions = parsed?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .map(normalizeSuggestion)
    .filter((suggestion): suggestion is string => suggestion !== null)
    .slice(0, 3);
}

function isChartKind(value: unknown): value is ChartKind {
  return value === "bar" || value === "line" || value === "pie";
}

function normalizeChartLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}

function validateChartSpec(block: string | null): ChartSpec | null {
  if (!block) return null;
  const parsed = parseJsonObject(block);
  if (!parsed || !isChartKind(parsed.kind) || !Array.isArray(parsed.series)) {
    return null;
  }
  if (parsed.series.length === 0 || parsed.series.length > 12) return null;

  const series: Array<{ label: string; value: number }> = [];
  for (const point of parsed.series) {
    const rec = asRecord(point);
    if (!rec) return null;
    const label = normalizeChartLabel(rec.label);
    const value = typeof rec.value === "number" ? rec.value : null;
    if (!label || value === null || !Number.isFinite(value)) return null;
    series.push({ label, value });
  }

  const xLabel = parsed.x_label === undefined
    ? undefined
    : normalizeChartLabel(parsed.x_label);
  const yLabel = parsed.y_label === undefined
    ? undefined
    : normalizeChartLabel(parsed.y_label);
  if (parsed.x_label !== undefined && !xLabel) return null;
  if (parsed.y_label !== undefined && !yLabel) return null;

  return {
    kind: parsed.kind,
    series,
    ...(xLabel ? { x_label: xLabel } : {}),
    ...(yLabel ? { y_label: yLabel } : {}),
  };
}

function normalizeThreadTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\"“”]/g, "")
    .replace(/[.!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 10) return null;
  return cleaned.length <= 80 ? cleaned : cleaned.slice(0, 80).trimEnd();
}

function parseThreadTitle(block: string | null): string | null {
  if (!block) return null;
  const parsed = parseJsonObject(block);
  return normalizeThreadTitle(parsed?.title);
}

function fallbackThreadTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (normalized.length <= 60) return normalized;
  return normalized.slice(0, 57).trimEnd() + "...";
}

function parseAnswerMetadata(rawAnswer: string): ParsedAnswerMetadata {
  return {
    answer: stripMetadataBlocks(rawAnswer),
    followUpSuggestions: parseFollowUpSuggestions(
      extractXmlBlock(rawAnswer, "follow_ups"),
    ),
    chartSpec: validateChartSpec(extractXmlBlock(rawAnswer, "chart")),
    threadTitle: parseThreadTitle(extractXmlBlock(rawAnswer, "thread_title")),
  };
}

function mergeDispatchAnswer(
  dispatchResult: DispatchResult,
  parsed: ParsedAnswerMetadata,
): DispatchResult {
  return {
    ...dispatchResult,
    answer: parsed.answer,
  };
}

function withAdditionalTokens(
  dispatchResult: DispatchResult,
  tokensIn: number,
  tokensOut: number,
  answer: string,
): DispatchResult {
  return {
    ...dispatchResult,
    answer,
    tokensIn: dispatchResult.tokensIn + tokensIn,
    tokensOut: dispatchResult.tokensOut + tokensOut,
    tokensUsed: dispatchResult.tokensUsed + tokensIn + tokensOut,
  };
}

async function reconcileTokenBudget(
  admin: SupabaseClient,
  t: RouterLogger,
  organizationId: string,
  dispatchResult: DispatchResult,
): Promise<void> {
  try {
    const actualCost = dispatchResult.tokensIn * SONNET_INPUT_USD_PER_TOKEN +
      dispatchResult.tokensOut * SONNET_OUTPUT_USD_PER_TOKEN;
    const delta = actualCost - PER_QUESTION_RESERVATION_USD;
    if (delta > 0) {
      await admin.rpc("_ai_token_budget_check", {
        p_organization_id: organizationId,
        p_cost_usd: delta,
      });
    }
  } catch (reconErr) {
    t.log({
      event: "budget_reconcile_failed",
      outcome: "error",
      organization_id: organizationId,
      error_message: String(reconErr),
    });
  }
}

type ThreadStateRow = {
  message_count: number | null;
  rolling_summary_text: string | null;
  rolling_summary_updated_at: string | null;
};

async function resolveOwnedActiveSessionId(
  admin: SupabaseClient,
  sessionId: string | null,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  if (!sessionId) return null;
  const { data, error } = await admin
    .from("exec_nlq_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id as string;
}

async function loadThreadState(
  admin: SupabaseClient,
  sessionId: string | null,
  organizationId: string,
): Promise<ThreadStateRow | null> {
  if (!sessionId) return null;
  const { data, error } = await admin
    .from("exec_nlq_sessions")
    .select("message_count, rolling_summary_text, rolling_summary_updated_at")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ThreadStateRow;
}

async function insertTurnMessages(args: {
  admin: SupabaseClient;
  t: RouterLogger;
  sessionId: string;
  organizationId: string;
  question: string;
  intent: IntentClassification;
  dispatchResult: DispatchResult;
  parsedAnswerMetadata: ParsedAnswerMetadata;
  aiInvocationId: string | null;
  streamed: boolean;
  fallbackUsed: boolean;
}): Promise<boolean> {
  const { data: reservedOrdinal, error: reserveErr } = await args.admin.rpc(
    "reserve_nlq_ordinals",
    { p_session_id: args.sessionId },
  );
  if (reserveErr) {
    args.t.log({
      event: "thread_ordinal_reserve_failed",
      outcome: "error",
      session_id: args.sessionId,
      error_message: reserveErr.message,
    });
    return false;
  }

  const userOrdinal = typeof reservedOrdinal === "number"
    ? reservedOrdinal
    : Number(reservedOrdinal);
  if (!Number.isFinite(userOrdinal) || userOrdinal <= 0) {
    args.t.log({
      event: "thread_ordinal_reserve_invalid",
      outcome: "error",
      session_id: args.sessionId,
      reserved_ordinal: reservedOrdinal,
    });
    return false;
  }

  const { error } = await args.admin
    .from("exec_nlq_messages")
    .insert([
      {
        session_id: args.sessionId,
        organization_id: args.organizationId,
        role: "user",
        content: args.question,
        ordinal: userOrdinal,
        streamed: args.streamed,
      },
      {
        session_id: args.sessionId,
        organization_id: args.organizationId,
        role: "assistant",
        content: args.dispatchResult.answer,
        ordinal: userOrdinal + 1,
        ai_invocation_id: args.aiInvocationId,
        citations: args.dispatchResult.citations,
        follow_ups: args.parsedAnswerMetadata.followUpSuggestions,
        chart_spec: args.parsedAnswerMetadata.chartSpec,
        intent: args.intent.intent,
        intent_confidence: args.intent.confidence,
        tools_used: args.dispatchResult.toolsUsed,
        fallback_used: args.fallbackUsed,
        tokens_used: args.dispatchResult.tokensUsed,
        tokens_in: args.dispatchResult.tokensIn,
        tokens_out: args.dispatchResult.tokensOut,
        model_used: args.dispatchResult.modelUsed ?? SONNET_MODEL,
        streamed: args.streamed,
      },
    ]);

  if (!error) return true;
  args.t.log({
    event: "thread_message_insert_failed",
    outcome: "error",
    session_id: args.sessionId,
    error_message: error.message,
  });
  return false;
}

async function persistRouterResponse(
  args: PersistRouterResponseArgs,
): Promise<PersistRouterResponseResult> {
  const {
    admin,
    t,
    organizationId,
    userId,
    question,
    routeContext,
    moduleContext,
    intent,
    dispatchResult,
  } = args;
  const phiClass = intent.intent === "clinical_record" ? "phi" : "limited";
  const [promptHash, responseHash] = await Promise.all([
    sha256Hex(`${intent.intent}::${question}`),
    sha256Hex(dispatchResult.answer),
  ]);

  let aiInvocationId: string | null = null;
  try {
    const { data: invRow, error: invErr } = await admin
      .from("ai_invocations")
      .insert({
        organization_id: organizationId,
        model: dispatchResult.modelUsed ?? ROUTER_MODEL_LABEL,
        phi_class: phiClass,
        prompt_hash: promptHash,
        response_hash: responseHash,
        tokens_used: dispatchResult.tokensUsed,
        created_by: userId,
        metadata_json: {
          function: "haven-ai-router",
          intent: intent.intent,
          intent_confidence: intent.confidence,
          intent_secondary: intent.secondary ?? null,
          tools_used: dispatchResult.toolsUsed,
          surface_route: routeContext,
          module_context: moduleContext,
          primary_intent_only_when_speculative:
            args.primaryIntentOnlyWhenSpeculative,
          tokens_in: dispatchResult.tokensIn,
          tokens_out: dispatchResult.tokensOut,
          refusal: dispatchResult.refusal ?? false,
          refusal_reason: dispatchResult.refusalReason ?? null,
          phi_blocked: dispatchResult.phiBlocked ?? false,
        },
      })
      .select("id")
      .single();
    if (invErr) {
      t.log({
        event: "ai_invocation_insert_failed",
        outcome: "error",
        error_message: invErr.message,
      });
    } else {
      aiInvocationId = (invRow?.id as string | null) ?? null;
    }
  } catch (err) {
    t.log({
      event: "ai_invocation_insert_threw",
      outcome: "error",
      error_message: String(err),
    });
  }

  let sessionId = args.bodySessionId;
  let sessionTitleAuto = true;
  const sessionStatus = dispatchResult.answer ? "completed" : "failed";
  const intentJson = {
    question_length: question.length,
    router_intent: intent.intent,
    router_confidence: intent.confidence,
    tools_used: dispatchResult.toolsUsed,
  };

  try {
    if (sessionId) {
      const { data: existingSession, error: existingErr } = await admin
        .from("exec_nlq_sessions")
        .select("id, title_auto")
        .eq("id", sessionId)
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (existingErr) {
        t.log({
          event: "session_lookup_failed",
          outcome: "error",
          error_message: existingErr.message,
        });
        sessionId = null;
      } else if (!existingSession?.id) {
        t.log({
          event: "session_lookup_missing",
          outcome: "miss",
          session_id: sessionId,
        });
        sessionId = null;
      } else {
        sessionTitleAuto = existingSession.title_auto !== false;
      }
    }
    if (!sessionId) {
      const { data: sessRow, error: sessErr } = await admin
        .from("exec_nlq_sessions")
        .insert({
          organization_id: organizationId,
          user_id: userId,
          title: fallbackThreadTitle(question),
          status: "submitted",
          created_by: userId,
        })
        .select("id, title_auto")
        .single();
      if (sessErr) {
        t.log({
          event: "session_insert_failed",
          outcome: "error",
          error_message: sessErr.message,
        });
      } else {
        sessionId = (sessRow?.id as string | null) ?? null;
        sessionTitleAuto = sessRow?.title_auto !== false;
      }
    }
  } catch (err) {
    t.log({
      event: "session_persist_threw",
      outcome: "error",
      error_message: String(err),
    });
  }

  let messagesInserted = false;
  if (sessionId) {
    try {
      messagesInserted = await insertTurnMessages({
        admin,
        t,
        sessionId,
        organizationId,
        question,
        intent,
        dispatchResult,
        parsedAnswerMetadata: args.parsedAnswerMetadata,
        aiInvocationId,
        streamed: args.streamed,
        fallbackUsed: !args.primaryIntentOnlyWhenSpeculative,
      });
    } catch (err) {
      t.log({
        event: "thread_message_insert_threw",
        outcome: "error",
        session_id: sessionId,
        error_message: String(err),
      });
    }
  }

  if (sessionId && messagesInserted) {
    const { error: updErr } = await admin
      .from("exec_nlq_sessions")
      .update({
        status: sessionStatus,
        ai_invocation_id: aiInvocationId,
        result_summary: dispatchResult.answer.slice(0, 4000),
        intent_json: intentJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (updErr) {
      t.log({
        event: "session_update_failed",
        outcome: "error",
        session_id: sessionId,
        error_message: updErr.message,
      });
    }

    if (args.shouldAutoTitle && sessionTitleAuto) {
      const nextTitle = args.parsedAnswerMetadata.threadTitle ??
        fallbackThreadTitle(question);
      const { error: titleErr } = await admin
        .from("exec_nlq_sessions")
        .update({
          title: nextTitle,
          title_generated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .eq("title_auto", true);
      if (titleErr) {
        t.log({
          event: "thread_title_update_failed",
          outcome: "error",
          session_id: sessionId,
          error_message: titleErr.message,
        });
      } else {
        t.log({
          event: "thread_title_generated",
          outcome: "success",
          session_id: sessionId,
          source: args.parsedAnswerMetadata.threadTitle ? "llm" : "fallback",
        });
      }
    }
  }

  const state = await loadThreadState(admin, sessionId, organizationId);
  return {
    sessionId,
    messageCount: typeof state?.message_count === "number"
      ? state.message_count
      : 0,
    rollingSummaryText: state?.rolling_summary_text ?? null,
    rollingSummaryUpdatedAt: state?.rolling_summary_updated_at ?? null,
  };
}

type SummaryMessageRow = {
  role: string;
  content: string | null;
  ordinal: number;
};

async function messagesSinceSummary(
  admin: SupabaseClient,
  sessionId: string,
  organizationId: string,
  rollingSummaryUpdatedAt: string | null,
): Promise<number> {
  if (!rollingSummaryUpdatedAt) return Number.POSITIVE_INFINITY;
  const { count, error } = await admin
    .from("exec_nlq_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gt("created_at", rollingSummaryUpdatedAt);
  if (error) return 0;
  return count ?? 0;
}

async function refreshRollingSummary(args: {
  admin: SupabaseClient;
  t: RouterLogger;
  sessionId: string;
  organizationId: string;
}): Promise<void> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return;

  const { data, error } = await args.admin
    .from("exec_nlq_messages")
    .select("role, content, ordinal")
    .eq("session_id", args.sessionId)
    .eq("organization_id", args.organizationId)
    .is("deleted_at", null)
    .in("role", ["user", "assistant"])
    .order("ordinal", { ascending: false })
    .limit(24);
  if (error) {
    args.t.log({
      event: "rolling_summary_load_failed",
      outcome: "error",
      session_id: args.sessionId,
      error_message: error.message,
    });
    return;
  }

  const transcript = ((data ?? []) as SummaryMessageRow[])
    .reverse()
    .map((row) => {
      const role = row.role === "assistant" ? "Assistant" : "User";
      const content = (row.content ?? "").replace(/\s+/g, " ").trim().slice(
        0,
        900,
      );
      return `${role}: ${content}`;
    })
    .join("\n");
  if (!transcript) return;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 180,
        system:
          "Summarize Haven Insight conversation history for future turns. Keep it under 500 characters. Preserve unresolved asks, facility names, metrics, caveats, and user preferences. Do not add facts.",
        messages: [{
          role: "user",
          content: `<conversation>\n${
            transcript.slice(0, 12000)
          }\n</conversation>`,
        }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const json = (await res.json()) as Record<string, unknown>;
    const blocks = json.content as
      | { type: string; text?: string }[]
      | undefined;
    const summary = String(blocks?.find((b) => b.type === "text")?.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    if (!summary) return;

    const { error: updateErr } = await args.admin
      .from("exec_nlq_sessions")
      .update({
        rolling_summary_text: summary,
        rolling_summary_updated_at: new Date().toISOString(),
      })
      .eq("id", args.sessionId)
      .eq("organization_id", args.organizationId);
    if (updateErr) {
      args.t.log({
        event: "rolling_summary_update_failed",
        outcome: "error",
        session_id: args.sessionId,
        error_message: updateErr.message,
      });
      return;
    }
    args.t.log({
      event: "rolling_summary_refreshed",
      outcome: "success",
      session_id: args.sessionId,
      model: HAIKU_MODEL,
    });
  } catch (err) {
    args.t.log({
      event: "rolling_summary_refresh_failed",
      outcome: "error",
      session_id: args.sessionId,
      error_message: String(err),
    });
  }
}

async function maybeRefreshRollingSummary(args: {
  admin: SupabaseClient;
  t: RouterLogger;
  persistResult: PersistRouterResponseResult;
  organizationId: string;
}): Promise<void> {
  const sessionId = args.persistResult.sessionId;
  if (!sessionId || args.persistResult.messageCount <= 12) return;

  const shouldRefresh = !args.persistResult.rollingSummaryText ||
    (await messagesSinceSummary(
        args.admin,
        sessionId,
        args.organizationId,
        args.persistResult.rollingSummaryUpdatedAt,
      )) >= 6;
  if (!shouldRefresh) return;

  await refreshRollingSummary({
    admin: args.admin,
    t: args.t,
    sessionId,
    organizationId: args.organizationId,
  });
}

function enqueueBackgroundTask(task: Promise<void>): void {
  const edgeRuntime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<void>) => void };
  }).EdgeRuntime;
  if (typeof edgeRuntime?.waitUntil === "function") {
    edgeRuntime.waitUntil(task);
    return;
  }
  void task.catch(() => undefined);
}

function buildStreamingFinalizerPrompt(args: {
  question: string;
  intent: IntentClassification;
  dispatchResult: DispatchResult;
  conversationContext: ConversationContext;
  isFirstTurn: boolean;
}): { system: string; user: string } {
  const citationsJson = JSON.stringify(
    args.dispatchResult.citations.slice(0, 12),
  );
  const toolsJson = JSON.stringify(args.dispatchResult.toolsUsed);
  const groundedDraft =
    parseAnswerMetadata(args.dispatchResult.answer).answer ||
    args.dispatchResult.answer;
  const history = renderConversationHistory(args.conversationContext);
  const firstTurnFlag = args.isFirstTurn
    ? "\n<is_first_turn>true</is_first_turn>"
    : "";
  const baseSystem =
    `You are Haven Executive Intelligence for assisted living facility operators.

You are given a grounded draft answer produced by Haven's backend tools. Stream the final answer for the executive.

Rules:
- Use ONLY the facts in the grounded draft answer and citation/tool context.
- Preserve all numbers, facility names, and caveats from the draft.
- Do not add new claims or fabricate data.
- Keep the visible answer concise and executive-grade.
- After the visible answer, on a new line, output:
<follow_ups>{"suggestions":["question 1","question 2","question 3"]}</follow_ups>
Each suggestion must be a natural next question and 80 characters or fewer.
- If the answer compares facilities, shows a trend, or aggregates by category, ALSO output:
<chart>{"kind":"bar"|"line"|"pie","series":[{"label":"...","value":N}],"x_label":"...","y_label":"..."}</chart>
Otherwise omit the chart block entirely.

If <is_first_turn>true</is_first_turn>, ALSO output a thread title block:
<thread_title>{"title":"..."}</thread_title>
The title must be 4–8 words, Title Case, no quotes, no trailing punctuation, and
summarise the topic the executive will recognise on returning to this thread
tomorrow. Examples: "Q3 Occupancy By Region", "Sunny Acres Incident Review",
"AR Aging Next Steps". If you cannot produce a clean title, omit the block.`;
  return {
    system: history ? `${history}\n\n${baseSystem}` : baseSystem,
    user:
      `<user_question>\n${args.question}\n</user_question>\n\n<intent>${args.intent.intent}</intent>${firstTurnFlag}\n<tools_used>${toolsJson}</tools_used>\n<citations>${citationsJson}</citations>\n\n<grounded_draft_answer>\n${groundedDraft}\n</grounded_draft_answer>`,
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createMetadataAwareEmitter(emit: (text: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  const maxTagLength = "<thread_title>".length;
  let pending = "";
  let hidden = false;

  return {
    push(chunk: string) {
      if (hidden) return;
      pending += chunk;
      const lower = pending.toLowerCase();
      const followIdx = lower.indexOf("<follow_ups>");
      const chartIdx = lower.indexOf("<chart>");
      const titleIdx = lower.indexOf("<thread_title>");
      const indexes = [followIdx, chartIdx, titleIdx].filter((idx) => idx >= 0);
      if (indexes.length > 0) {
        const firstMetaIdx = Math.min(...indexes);
        const visible = pending.slice(0, firstMetaIdx);
        if (visible) emit(visible);
        pending = "";
        hidden = true;
        return;
      }
      if (pending.length > maxTagLength) {
        const flushUntil = pending.length - maxTagLength;
        emit(pending.slice(0, flushUntil));
        pending = pending.slice(flushUntil);
      }
    },
    flush() {
      if (!hidden && pending) emit(pending);
      pending = "";
    },
  };
}

async function streamAnthropicFinalAnswer(args: {
  question: string;
  intent: IntentClassification;
  dispatchResult: DispatchResult;
  conversationContext: ConversationContext;
  isFirstTurn: boolean;
  onTextDelta: (text: string) => void;
}): Promise<StreamFinalAnswerResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { rawAnswer: "", tokensIn: 0, tokensOut: 0, ok: false };

  const prompt = buildStreamingFinalizerPrompt(args);
  let rawAnswer = "";
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: MAX_STREAM_ANSWER_TOKENS,
        stream: true,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      return { rawAnswer, tokensIn, tokensOut, ok: false };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice("data:".length).trim();
        if (!data || data === "[DONE]") continue;
        const event = parseJsonObject(data);
        if (!event) continue;

        if (event.type === "message_start") {
          const message = asRecord(event.message);
          const usage = asRecord(message?.usage);
          tokensIn += readNumber(usage?.input_tokens);
        } else if (event.type === "content_block_delta") {
          const delta = asRecord(event.delta);
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            rawAnswer += delta.text;
            args.onTextDelta(delta.text);
          }
        } else if (event.type === "message_delta") {
          const usage = asRecord(event.usage);
          const outputTokens = readNumber(usage?.output_tokens);
          if (outputTokens > 0) tokensOut = outputTokens;
        }
      }
    }

    buffer += decoder.decode();
    return { rawAnswer, tokensIn, tokensOut, ok: rawAnswer.trim().length > 0 };
  } catch {
    return { rawAnswer, tokensIn, tokensOut, ok: false };
  }
}

function enqueueSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: unknown,
): void {
  const encoder = new TextEncoder();
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  controller.enqueue(encoder.encode(`data: ${text}\n\n`));
}

function emitAnswerInChunks(
  controller: ReadableStreamDefaultController<Uint8Array>,
  answer: string,
): void {
  const chunkSize = 80;
  for (let i = 0; i < answer.length; i += chunkSize) {
    enqueueSse(controller, {
      type: "token",
      content: answer.slice(i, i + chunkSize),
    });
  }
}

function streamResponse(args: {
  origin: string | null;
  admin: SupabaseClient;
  t: RouterLogger;
  bodySessionId: string | null;
  organizationId: string;
  userId: string;
  question: string;
  routeContext: string | null;
  moduleContext: string | null;
  intent: IntentClassification;
  dispatchResult: DispatchResult;
  conversationContext: ConversationContext;
  primaryIntentOnlyWhenSpeculative: boolean;
}): Response {
  let emittedVisibleToken = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const filteredEmitter = createMetadataAwareEmitter((content) => {
          if (!content) return;
          emittedVisibleToken = true;
          enqueueSse(controller, { type: "token", content });
        });
        const streamed = await streamAnthropicFinalAnswer({
          question: args.question,
          intent: args.intent,
          dispatchResult: args.dispatchResult,
          conversationContext: args.conversationContext,
          isFirstTurn: args.conversationContext.messageCount === 0,
          onTextDelta: filteredEmitter.push,
        });
        filteredEmitter.flush();

        const rawAnswer = streamed.ok
          ? streamed.rawAnswer
          : args.dispatchResult.answer;
        const parsed = parseAnswerMetadata(rawAnswer);
        if (!emittedVisibleToken && parsed.answer) {
          emitAnswerInChunks(controller, parsed.answer);
        }

        const finalResult = streamed.ok
          ? withAdditionalTokens(
            args.dispatchResult,
            streamed.tokensIn,
            streamed.tokensOut,
            parsed.answer,
          )
          : mergeDispatchAnswer(args.dispatchResult, parsed);
        await reconcileTokenBudget(
          args.admin,
          args.t,
          args.organizationId,
          finalResult,
        );
        const persistResult = await persistRouterResponse({
          admin: args.admin,
          t: args.t,
          bodySessionId: args.bodySessionId,
          organizationId: args.organizationId,
          userId: args.userId,
          question: args.question,
          routeContext: args.routeContext,
          moduleContext: args.moduleContext,
          intent: args.intent,
          dispatchResult: finalResult,
          primaryIntentOnlyWhenSpeculative:
            args.primaryIntentOnlyWhenSpeculative,
          parsedAnswerMetadata: parsed,
          streamed: true,
          shouldAutoTitle: args.conversationContext.messageCount === 0,
        });
        enqueueBackgroundTask(maybeRefreshRollingSummary({
          admin: args.admin,
          t: args.t,
          persistResult,
          organizationId: args.organizationId,
        }));

        enqueueSse(controller, {
          type: "meta",
          session_id: persistResult.sessionId,
          citations: finalResult.citations,
          intent: args.intent.intent,
          intent_confidence: args.intent.confidence,
          tools_used: finalResult.toolsUsed,
          fallback_used: !args.primaryIntentOnlyWhenSpeculative,
          follow_up_suggestions: parsed.followUpSuggestions,
          chart_spec: parsed.chartSpec,
          tokens_used: finalResult.tokensUsed,
        });
        enqueueSse(controller, "[DONE]");
      } catch (err) {
        captureException(err, {
          event: "router_stream_failed",
          organization_id: args.organizationId,
        });
        enqueueSse(controller, { type: "error", message: "Stream failed" });
        enqueueSse(controller, "[DONE]");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...getCorsHeaders(args.origin),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                      */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  const t = withTiming("haven-ai-router");
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  // --- Auth ---
  let admin;
  try {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  } catch (err) {
    t.log({
      event: "client_create_failed",
      outcome: "error",
      error_message: String(err),
    });
    captureException(err, { event: "router_init_failed" });
    return routerFailureResponse(origin, "Router initialization failed");
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  let userId: string | null = null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      t.log({ event: "auth_failed", outcome: "blocked" });
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }
    userId = data.user.id;
  } catch (err) {
    t.log({
      event: "auth_threw",
      outcome: "error",
      error_message: String(err),
    });
    captureException(err, { event: "router_auth_failed" });
    return routerFailureResponse(origin, "Auth check failed");
  }

  // --- Rate limit (per-user + per-org, KB-NEXT-03 G3) ---
  if (isRateLimited(userId)) {
    t.log({
      event: "rate_limited",
      outcome: "blocked",
      scope: "user",
      user_id: userId,
    });
    return jsonResponse(
      { error: "Rate limit exceeded. Try again in a minute." },
      429,
      origin,
    );
  }

  // --- Parse body ---
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const question = typeof body.question === "string"
    ? body.question.trim()
    : "";
  if (!question) {
    return jsonResponse({ error: "question is required" }, 400, origin);
  }
  if (question.length > 2000) {
    return jsonResponse(
      { error: "question exceeds 2000 characters" },
      400,
      origin,
    );
  }

  const routeContext = body.route ?? null;
  const moduleContext = body.module ?? null;
  const selectedFacilityId = body.facility_id ?? null;

  // --- Profile lookup ---
  let role = "caregiver";
  let organizationId: string | null = null;
  try {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("app_role, organization_id")
      .eq("id", userId)
      .single();
    role = String(profile?.app_role ?? "caregiver");
    organizationId = (profile?.organization_id ?? null) as string | null;
  } catch (err) {
    t.log({
      event: "profile_lookup_failed",
      outcome: "error",
      error_message: String(err),
    });
    captureException(err, { event: "router_profile_lookup_failed" });
    return routerFailureResponse(origin, "Profile lookup failed");
  }

  if (!organizationId) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }
  if (!ALLOWED_ROLES.includes(role)) {
    t.log({ event: "role_denied", outcome: "blocked", role });
    return jsonResponse(
      { error: "Insufficient permissions for Haven AI" },
      403,
      origin,
    );
  }

  if (isOrgRateLimited(organizationId)) {
    t.log({
      event: "rate_limited",
      outcome: "blocked",
      scope: "org",
      organization_id: organizationId,
    });
    return jsonResponse(
      { error: "Organization rate limit exceeded. Try again in a minute." },
      429,
      origin,
    );
  }

  // --- Token budget pre-check (KB-NEXT-03 §D) ---
  // Reserve a conservative cost up front; if the model later spends less, the
  // reservation is fine (we don't refund). If the org is already over budget,
  // refuse with 429 + Sentry alert. Falls open if the RPC errors out — safer
  // than blocking on infra hiccups.
  try {
    const { data: budgetData, error: budgetErr } = await admin.rpc(
      "_ai_token_budget_check",
      {
        p_organization_id: organizationId,
        p_cost_usd: PER_QUESTION_RESERVATION_USD,
      },
    );
    if (budgetErr) {
      t.log({
        event: "budget_check_failed",
        outcome: "error",
        organization_id: organizationId,
        error_message: budgetErr.message,
      });
    } else if (budgetData && typeof budgetData === "object") {
      const allowed = (budgetData as Record<string, unknown>).allowed;
      const softAlert = (budgetData as Record<string, unknown>).soft_alert;
      if (allowed === false) {
        captureMessage(
          "AI org_budget_exceeded",
          "error",
          {
            organization_id: organizationId,
            user_id: userId,
            daily_limit: (budgetData as Record<string, unknown>).daily_limit,
            daily_usage: (budgetData as Record<string, unknown>).daily_usage,
          },
        );
        t.log({
          event: "org_budget_exceeded",
          outcome: "blocked",
          organization_id: organizationId,
        });
        return jsonResponse(
          {
            ok: false,
            error: "org_budget_exceeded",
            daily_limit: (budgetData as Record<string, unknown>).daily_limit,
            daily_usage: (budgetData as Record<string, unknown>).daily_usage,
          },
          429,
          origin,
        );
      }
      if (softAlert === true) {
        captureMessage(
          "AI org budget soft alert (>=80% of daily limit)",
          "warning",
          {
            organization_id: organizationId,
            daily_limit: (budgetData as Record<string, unknown>).daily_limit,
            daily_usage: (budgetData as Record<string, unknown>).daily_usage,
          },
        );
      }
    }
  } catch (budgetThrew) {
    t.log({
      event: "budget_check_threw",
      outcome: "error",
      organization_id: organizationId,
      error_message: String(budgetThrew),
    });
  }

  // --- Resolve accessible facility ids once per request (KB-NEXT-02) ---
  // Org-wide roles (owner / org_admin) see every facility in the org, mirroring
  // the haven.accessible_facility_ids() helper. Other roles see whatever rows
  // user_facility_access grants them. This is computed once and passed into
  // dispatch / runToolLoop on every tool RPC.
  let facilityIds: string[] = [];
  try {
    if (role === "owner" || role === "org_admin") {
      const { data, error } = await admin
        .from("facilities")
        .select("id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null);
      if (error) {
        t.log({
          event: "facility_lookup_failed",
          outcome: "error",
          error_message: error.message,
        });
      } else {
        facilityIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
      }
    } else {
      const { data, error } = await admin
        .from("user_facility_access")
        .select("facility_id")
        .eq("user_id", userId)
        .eq("organization_id", organizationId)
        .is("revoked_at", null);
      if (error) {
        t.log({
          event: "facility_lookup_failed",
          outcome: "error",
          error_message: error.message,
        });
      } else {
        facilityIds = ((data ?? []) as { facility_id: string }[]).map((r) =>
          r.facility_id
        );
      }
    }
  } catch (err) {
    t.log({
      event: "facility_lookup_threw",
      outcome: "error",
      error_message: String(err),
    });
  }

  // --- Classify intent (with cache) ---
  let intent: IntentClassification;
  const cacheKey = `${role}::${normalizeQuestion(question)}`;
  const cached = intentCache.get(cacheKey);
  if (cached) {
    intent = cached;
    t.log({
      event: "intent_cache_hit",
      intent: intent.intent,
      confidence: intent.confidence,
    });
  } else {
    try {
      intent = await classifyIntent(question, {
        surfaceContext: routeContext ?? undefined,
        userRole: role,
      });
      intentCache.set(cacheKey, intent);
      t.log({
        event: "intent_classified",
        intent: intent.intent,
        confidence: intent.confidence,
        secondary: intent.secondary ?? null,
      });
    } catch (err) {
      t.log({
        event: "classify_threw",
        outcome: "error",
        error_message: String(err),
      });
      captureException(err, {
        event: "router_classify_failed",
        organization_id: organizationId,
      });
      return routerFailureResponse(origin, "Intent classification failed");
    }
  }

  // --- Dry-run path: classification-only for eval harness ---
  if (dryRun === "intent_only") {
    return jsonResponse(
      {
        ok: true,
        intent: intent.intent,
        confidence: intent.confidence,
        secondary: intent.secondary ?? null,
        reasoning: intent.reasoning,
      },
      200,
      origin,
    );
  }

  const requestedSessionId = body.session_id ?? null;
  const bodySessionId = await resolveOwnedActiveSessionId(
    admin,
    requestedSessionId,
    organizationId,
    userId,
  );
  if (requestedSessionId && !bodySessionId) {
    t.log({
      event: "session_id_rejected",
      outcome: "blocked",
      session_id: requestedSessionId,
    });
  }
  let conversationContext: ConversationContext = {
    priorTurns: [],
    rollingSummary: null,
    messageCount: 0,
  };
  try {
    conversationContext = await loadConversationContext(
      admin,
      bodySessionId,
      organizationId,
      userId,
    );
  } catch (err) {
    t.log({
      event: "context_window_load_failed",
      outcome: "error",
      session_id: bodySessionId,
      error_message: String(err),
    });
  }
  t.log({
    event: "context_window_assembled",
    outcome: "success",
    session_id: bodySessionId,
    message_count: conversationContext.messageCount,
    prior_turns: conversationContext.priorTurns.length,
    has_rolling_summary: Boolean(conversationContext.rollingSummary),
  });

  // --- Speculative dispatch on low confidence ---
  // Don't pay for two Sonnet calls. Run the top intent's branch first; only
  // fall through to `mixed` when the top intent returned a refusal AND the
  // classifier confidence was below the threshold.
  let dispatchResult: DispatchResult;
  let primaryIntentOnlyWhenSpeculative = true;
  try {
    dispatchResult = await dispatch({
      admin,
      intent,
      question,
      organizationId,
      userRole: role,
      userId: userId,
      selectedFacilityId,
      moduleContext,
      facilityIds,
      conversationContext,
    });

    const lowConfidence = intent.confidence < SPECULATIVE_DISPATCH_THRESHOLD;
    if (
      lowConfidence && dispatchResult.refusal && intent.intent !== "mixed" &&
      intent.intent !== "refuse"
    ) {
      const fallbackIntent: IntentClassification = {
        intent: "mixed",
        confidence: intent.confidence,
        reasoning: "speculative_fallback_after_refusal",
      };
      const fallbackResult = await dispatch({
        admin,
        intent: fallbackIntent,
        question,
        organizationId,
        userRole: role,
        userId,
        selectedFacilityId,
        moduleContext,
        facilityIds,
        conversationContext,
      });
      if (!fallbackResult.refusal && fallbackResult.answer.length > 0) {
        dispatchResult = fallbackResult;
        primaryIntentOnlyWhenSpeculative = false;
      }
    }
  } catch (err) {
    t.log({
      event: "dispatch_threw",
      outcome: "error",
      error_message: String(err),
    });
    captureException(err, {
      event: "router_dispatch_failed",
      organization_id: organizationId,
      intent: intent.intent,
    });
    return routerFailureResponse(origin, "Dispatch failed");
  }

  // --- PHI gate → 403 (still audited; no streaming for blocked PHI responses) ---
  if (dispatchResult.phiBlocked) {
    const parsed = parseAnswerMetadata(dispatchResult.answer);
    dispatchResult = mergeDispatchAnswer(dispatchResult, parsed);
    await reconcileTokenBudget(admin, t, organizationId, dispatchResult);
    const persistResult = await persistRouterResponse({
      admin,
      t,
      bodySessionId,
      organizationId,
      userId,
      question,
      routeContext,
      moduleContext,
      intent,
      dispatchResult,
      primaryIntentOnlyWhenSpeculative,
      parsedAnswerMetadata: parsed,
      streamed: false,
      shouldAutoTitle: conversationContext.messageCount === 0,
    });
    enqueueBackgroundTask(maybeRefreshRollingSummary({
      admin,
      t,
      persistResult,
      organizationId,
    }));
    t.log({
      event: "phi_blocked",
      outcome: "blocked",
      intent: intent.intent,
      user_id: userId,
    });
    return jsonResponse(
      {
        ok: false,
        error: "phi_blocked",
        session_id: persistResult.sessionId,
        answer: dispatchResult.answer,
        citations: dispatchResult.citations,
        intent: intent.intent,
        intent_confidence: intent.confidence,
        tools_used: dispatchResult.toolsUsed,
        fallback_used: !primaryIntentOnlyWhenSpeculative,
        follow_up_suggestions: parsed.followUpSuggestions,
        chart_spec: parsed.chartSpec,
      },
      403,
      origin,
    );
  }

  if (wantsSse(req)) {
    return streamResponse({
      origin,
      admin,
      t,
      bodySessionId,
      organizationId,
      userId,
      question,
      routeContext,
      moduleContext,
      intent,
      dispatchResult,
      conversationContext,
      primaryIntentOnlyWhenSpeculative,
    });
  }

  const parsed = parseAnswerMetadata(dispatchResult.answer);
  dispatchResult = mergeDispatchAnswer(dispatchResult, parsed);
  await reconcileTokenBudget(admin, t, organizationId, dispatchResult);
  const persistResult = await persistRouterResponse({
    admin,
    t,
    bodySessionId,
    organizationId,
    userId,
    question,
    routeContext,
    moduleContext,
    intent,
    dispatchResult,
    primaryIntentOnlyWhenSpeculative,
    parsedAnswerMetadata: parsed,
    streamed: false,
    shouldAutoTitle: conversationContext.messageCount === 0,
  });
  enqueueBackgroundTask(maybeRefreshRollingSummary({
    admin,
    t,
    persistResult,
    organizationId,
  }));

  t.log({
    event: "router_completed",
    outcome: "success",
    session_id: persistResult.sessionId,
    intent: intent.intent,
    intent_confidence: intent.confidence,
    tokens_used: dispatchResult.tokensUsed,
    tools_used: dispatchResult.toolsUsed,
    refusal: dispatchResult.refusal ?? false,
  });

  return jsonResponse(
    {
      ok: true,
      session_id: persistResult.sessionId,
      answer: dispatchResult.answer,
      citations: dispatchResult.citations,
      tokens_used: dispatchResult.tokensUsed,
      intent: intent.intent,
      intent_confidence: intent.confidence,
      tools_used: dispatchResult.toolsUsed,
      fallback_used: !primaryIntentOnlyWhenSpeculative,
      refusal: dispatchResult.refusal ?? false,
      refusal_reason: dispatchResult.refusalReason ?? null,
      follow_up_suggestions: parsed.followUpSuggestions,
      chart_spec: parsed.chartSpec,
    },
    200,
    origin,
  );
});
