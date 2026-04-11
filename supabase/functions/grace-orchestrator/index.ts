import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { redactString, redactValue } from "../_shared/redact-pii.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL_FULL = "claude-sonnet-4-6";
const MODEL_REDUCED = "claude-haiku-4-5-20251001";
const SOFT_CAP_TOKENS = 50_000;
const HARD_CAP_TOKENS = 150_000;

type RequestBody = {
  text?: string;
  conversation_id?: string;
  input_mode?: "text" | "voice" | "hybrid";
  route?: string;
};

type FlowDefinitionLite = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  grace_metadata: Record<string, unknown>;
  high_value_threshold_cents: number | null;
  roles_allowed: string[] | null;
};

type GraceClassifierResult = {
  category: "FLOW_DISPATCH" | "READ_ANSWER" | "AGENTIC_TASK" | "HUMAN_ESCALATION" | "CLARIFY" | "COST_LIMIT";
  confidence: number;
  flow_id: string | null;
  prefilled_slots: Record<string, unknown> | null;
  answer_query: string | null;
  agentic_brief: string | null;
  escalation_reason: string | null;
  clarification_needed: string | null;
};

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getTokensToday(admin: any, userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("grace_usage_counters")
    .select("tokens_in,tokens_out")
    .eq("user_id", userId)
    .eq("bucket_date", today)
    .maybeSingle();
  return Number(data?.tokens_in ?? 0) + Number(data?.tokens_out ?? 0);
}

async function ensureConversation(
  admin: any,
  userId: string,
  organizationId: string,
  conversationId: string | undefined,
  inputMode: "text" | "voice" | "hybrid",
  route: string | undefined,
): Promise<string> {
  if (conversationId) {
    const { data } = await admin
      .from("grace_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  const { data, error } = await admin
    .from("grace_conversations")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      input_mode: inputMode,
      route_at_start: route ?? null,
    })
    .select("id")
    .single();

  if (error || !data?.id) throw new Error(`conversation insert failed: ${error?.message ?? "unknown"}`);
  return data.id as string;
}

async function loadAllowedFlows(admin: any, organizationId: string, role: string): Promise<FlowDefinitionLite[]> {
  const { data, error } = await admin
    .from("flow_workflow_definitions")
    .select("id,slug,name,description,grace_metadata,high_value_threshold_cents,roles_allowed")
    .eq("organization_id", organizationId)
    .eq("surface", "grace")
    .eq("enabled", true)
    .is("deleted_at", null);
  if (error || !data) return [];
  return (data as FlowDefinitionLite[]).filter((flow) => !flow.roles_allowed || flow.roles_allowed.length === 0 || flow.roles_allowed.includes(role));
}

function buildSystemPrompt(flows: FlowDefinitionLite[], route: string | undefined) {
  const flowList = flows
    .map((flow) => `- ${flow.slug}: ${flow.name}${flow.description ? ` — ${flow.description}` : ""}`)
    .join("\n");

  return `You are Grace, the Circle of Life care companion router.

Your only job is to classify the user's intent and decide whether to:
- dispatch a Grace flow
- answer via the knowledge agent
- ask for clarification
- escalate to a human

Current route: ${route ?? "unknown"}

Allowed flows for this operator:
${flowList || "- none"}

Return strict JSON only with these keys:
{
  "category": "FLOW_DISPATCH" | "READ_ANSWER" | "AGENTIC_TASK" | "HUMAN_ESCALATION" | "CLARIFY" | "COST_LIMIT",
  "confidence": number,
  "flow_id": string | null,
  "prefilled_slots": object | null,
  "answer_query": string | null,
  "agentic_brief": string | null,
  "escalation_reason": string | null,
  "clarification_needed": string | null
}

Rules:
- Use FLOW_DISPATCH only when the user clearly wants an action that matches an allowed flow.
- Use the flow slug in flow_id when category is FLOW_DISPATCH.
- Use READ_ANSWER for resident, policy, census, medication, incident, staff, compliance, or general questions.
- Use CLARIFY when the user intent is missing required context.
- Never invent a flow that is not in the allowlist.
- Never output prose outside the JSON object.`;
}

function normalizeClassification(
  parsed: Record<string, unknown> | null,
  flows: FlowDefinitionLite[],
  text: string,
): GraceClassifierResult {
  const defaultResult: GraceClassifierResult = {
    category: "READ_ANSWER",
    confidence: 0.4,
    flow_id: null,
    prefilled_slots: null,
    answer_query: text.slice(0, 500),
    agentic_brief: null,
    escalation_reason: null,
    clarification_needed: null,
  };

  if (!parsed) return defaultResult;

  const category = typeof parsed.category === "string" ? parsed.category : "READ_ANSWER";
  const confidence = Number(parsed.confidence);
  const requestedFlow = typeof parsed.flow_id === "string" ? parsed.flow_id : null;
  const matchedFlow = flows.find((flow) => flow.slug === requestedFlow || flow.id === requestedFlow);

  if (category === "FLOW_DISPATCH" && !matchedFlow) {
    return {
      ...defaultResult,
      category: "CLARIFY",
      clarification_needed: "I can help with a note, incident, or assessment, but I need a supported Grace action.",
    };
  }

  return {
    category:
      category === "FLOW_DISPATCH" ||
        category === "READ_ANSWER" ||
        category === "AGENTIC_TASK" ||
        category === "HUMAN_ESCALATION" ||
        category === "CLARIFY" ||
        category === "COST_LIMIT"
        ? category
        : "READ_ANSWER",
    confidence: Number.isFinite(confidence) ? confidence : 0.4,
    flow_id: matchedFlow?.id ?? null,
    prefilled_slots:
      parsed.prefilled_slots && typeof parsed.prefilled_slots === "object"
        ? redactValue(parsed.prefilled_slots as Record<string, unknown>)
        : null,
    answer_query: typeof parsed.answer_query === "string" ? redactString(parsed.answer_query) : text.slice(0, 500),
    agentic_brief: typeof parsed.agentic_brief === "string" ? redactString(parsed.agentic_brief) : null,
    escalation_reason: typeof parsed.escalation_reason === "string" ? redactString(parsed.escalation_reason) : null,
    clarification_needed: typeof parsed.clarification_needed === "string" ? redactString(parsed.clarification_needed) : null,
  };
}

Deno.serve(async (req) => {
  const t = withTiming("grace-orchestrator");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    t.log({ event: "auth_failed", outcome: "blocked" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return jsonResponse({ error: "text is required" }, 400, origin);
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();

  const role = String(profile?.app_role ?? user.app_metadata?.app_role ?? "caregiver");
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }

  const tokensToday = await getTokensToday(admin, user.id);
  if (tokensToday >= HARD_CAP_TOKENS) {
    return jsonResponse(
      {
        ok: false,
        category: "COST_LIMIT",
        message: "Grace is resting. Daily usage resets at midnight.",
        tokens_today: tokensToday,
      },
      200,
      origin,
    );
  }

  const model = tokensToday >= SOFT_CAP_TOKENS ? MODEL_REDUCED : MODEL_FULL;
  const degradationState = tokensToday >= SOFT_CAP_TOKENS ? "reduced" : "full";
  const flows = await loadAllowedFlows(admin, organizationId, role);

  const system = buildSystemPrompt(flows, body.route);
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: text }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    t.log({ event: "classifier_failed", outcome: "error", error_message: errText.slice(0, 300) });
    return jsonResponse({ error: "Grace classifier failed" }, 502, origin);
  }

  const anthropicJson = await anthropicRes.json();
  const rawText = String(
    anthropicJson.content?.find((block: { type: string }) => block.type === "text")?.text ?? "",
  );
  const parsed = extractJsonObject(rawText);
  const classification = normalizeClassification(parsed, flows, text);
  const selectedFlow = flows.find((flow) => flow.id === classification.flow_id) ?? null;

  const conversationId = await ensureConversation(
    admin,
    user.id,
    organizationId,
    body.conversation_id,
    body.input_mode === "voice" || body.input_mode === "hybrid" ? body.input_mode : "text",
    body.route,
  );

  const tokensIn = Number(anthropicJson.usage?.input_tokens ?? 0);
  const tokensOut = Number(anthropicJson.usage?.output_tokens ?? 0);
  await admin.rpc("grace_increment_usage", {
    p_user_id: user.id,
    p_organization_id: organizationId,
    p_classifications: 1,
    p_tokens_in: tokensIn,
    p_tokens_out: tokensOut,
  });

  t.log({
    event: "grace_orchestrated",
    outcome: "success",
    category: classification.category,
    conversation_id: conversationId,
    model,
  });

  return jsonResponse(
    {
      ok: true,
      conversation_id: conversationId,
      classification,
      flow_definition: selectedFlow
        ? {
          id: selectedFlow.id,
          slug: selectedFlow.slug,
          name: selectedFlow.name,
          description: selectedFlow.description,
          grace_metadata: redactValue(selectedFlow.grace_metadata ?? {}),
          high_value_threshold_cents: selectedFlow.high_value_threshold_cents,
        }
        : null,
      degradation_state: degradationState,
      tokens_today: tokensToday + tokensIn + tokensOut,
      model,
    },
    200,
    origin,
  );
});
