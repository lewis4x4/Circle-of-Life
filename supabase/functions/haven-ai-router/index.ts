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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import {
  classifyIntent,
  intentCache,
  normalizeQuestion,
  type IntentClassification,
} from "../_shared/router-intent.ts";
import { dispatch, type DispatchResult } from "../_shared/router-dispatch.ts";

/* ------------------------------------------------------------------ */
/*  Env                                                               */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROUTER_MODEL_LABEL = "haven-ai-router";

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

function routerFailureResponse(origin: string | null, message: string, status = 500): Response {
  return jsonResponseWithHeader(
    { ok: false, error: message },
    status,
    origin,
    { "X-Router-Failure": "true" },
  );
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
    t.log({ event: "client_create_failed", outcome: "error", error_message: String(err) });
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
    t.log({ event: "auth_threw", outcome: "error", error_message: String(err) });
    return routerFailureResponse(origin, "Auth check failed");
  }

  // --- Rate limit ---
  if (isRateLimited(userId)) {
    t.log({ event: "rate_limited", outcome: "blocked", user_id: userId });
    return jsonResponse({ error: "Rate limit exceeded. Try again in a minute." }, 429, origin);
  }

  // --- Parse body ---
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return jsonResponse({ error: "question is required" }, 400, origin);
  }
  if (question.length > 2000) {
    return jsonResponse({ error: "question exceeds 2000 characters" }, 400, origin);
  }

  const routeContext = body.route ?? null;
  const moduleContext = body.module ?? null;
  const selectedFacilityId = body.facility_id ?? null;
  const userRoleHint = body.role ?? null;

  // --- Profile lookup ---
  let role = "caregiver";
  let organizationId: string | null = null;
  try {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("app_role, organization_id")
      .eq("id", userId)
      .single();
    role = String(profile?.app_role ?? userRoleHint ?? "caregiver");
    organizationId = (profile?.organization_id ?? null) as string | null;
  } catch (err) {
    t.log({ event: "profile_lookup_failed", outcome: "error", error_message: String(err) });
    return routerFailureResponse(origin, "Profile lookup failed");
  }

  if (!organizationId) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }
  if (!ALLOWED_ROLES.includes(role)) {
    t.log({ event: "role_denied", outcome: "blocked", role });
    return jsonResponse({ error: "Insufficient permissions for Haven AI" }, 403, origin);
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
        t.log({ event: "facility_lookup_failed", outcome: "error", error_message: error.message });
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
        t.log({ event: "facility_lookup_failed", outcome: "error", error_message: error.message });
      } else {
        facilityIds = ((data ?? []) as { facility_id: string }[]).map((r) => r.facility_id);
      }
    }
  } catch (err) {
    t.log({ event: "facility_lookup_threw", outcome: "error", error_message: String(err) });
  }

  // --- Classify intent (with cache) ---
  let intent: IntentClassification;
  const cacheKey = `${role}::${normalizeQuestion(question)}`;
  const cached = intentCache.get(cacheKey);
  if (cached) {
    intent = cached;
    t.log({ event: "intent_cache_hit", intent: intent.intent, confidence: intent.confidence });
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
      t.log({ event: "classify_threw", outcome: "error", error_message: String(err) });
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
    });

    const lowConfidence = intent.confidence < SPECULATIVE_DISPATCH_THRESHOLD;
    if (lowConfidence && dispatchResult.refusal && intent.intent !== "mixed" && intent.intent !== "refuse") {
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
      });
      if (!fallbackResult.refusal && fallbackResult.answer.length > 0) {
        dispatchResult = fallbackResult;
        primaryIntentOnlyWhenSpeculative = false;
      }
    }
  } catch (err) {
    t.log({ event: "dispatch_threw", outcome: "error", error_message: String(err) });
    return routerFailureResponse(origin, "Dispatch failed");
  }

  // --- Audit: ai_invocations + exec_nlq_sessions ---
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
          primary_intent_only_when_speculative: primaryIntentOnlyWhenSpeculative,
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
    t.log({ event: "ai_invocation_insert_threw", outcome: "error", error_message: String(err) });
  }

  // --- exec_nlq_sessions parity ---
  let sessionId = body.session_id ?? null;
  const sessionStatus = dispatchResult.answer ? "completed" : "failed";
  const intentJson = {
    question_length: question.length,
    router_intent: intent.intent,
    router_confidence: intent.confidence,
    tools_used: dispatchResult.toolsUsed,
  };

  try {
    if (sessionId) {
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
        .eq("organization_id", organizationId);
      if (updErr) {
        t.log({
          event: "session_update_failed",
          outcome: "error",
          error_message: updErr.message,
        });
        sessionId = null;
      }
    }
    if (!sessionId) {
      const title = question.length > 100 ? question.slice(0, 97) + "..." : question;
      const { data: sessRow, error: sessErr } = await admin
        .from("exec_nlq_sessions")
        .insert({
          organization_id: organizationId,
          user_id: userId,
          title,
          status: sessionStatus,
          ai_invocation_id: aiInvocationId,
          result_summary: dispatchResult.answer.slice(0, 4000),
          intent_json: intentJson,
          created_by: userId,
        })
        .select("id")
        .single();
      if (sessErr) {
        t.log({
          event: "session_insert_failed",
          outcome: "error",
          error_message: sessErr.message,
        });
      } else {
        sessionId = (sessRow?.id as string | null) ?? null;
      }
    }
  } catch (err) {
    t.log({ event: "session_persist_threw", outcome: "error", error_message: String(err) });
  }

  // --- PHI gate → 403 (still audited above) ---
  if (dispatchResult.phiBlocked) {
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
        session_id: sessionId,
        answer: dispatchResult.answer,
        citations: dispatchResult.citations,
        intent: intent.intent,
        intent_confidence: intent.confidence,
        tools_used: dispatchResult.toolsUsed,
      },
      403,
      origin,
    );
  }

  t.log({
    event: "router_completed",
    outcome: "success",
    session_id: sessionId,
    intent: intent.intent,
    intent_confidence: intent.confidence,
    tokens_used: dispatchResult.tokensUsed,
    tools_used: dispatchResult.toolsUsed,
    refusal: dispatchResult.refusal ?? false,
  });

  return jsonResponse(
    {
      ok: true,
      session_id: sessionId,
      answer: dispatchResult.answer,
      citations: dispatchResult.citations,
      tokens_used: dispatchResult.tokensUsed,
      intent: intent.intent,
      intent_confidence: intent.confidence,
      tools_used: dispatchResult.toolsUsed,
      fallback_used: false,
      refusal: dispatchResult.refusal ?? false,
      refusal_reason: dispatchResult.refusalReason ?? null,
    },
    200,
    origin,
  );
});
