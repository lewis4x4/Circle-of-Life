/**
 * tools.ts — Claude tool-use loop for haven-ai-router (KB-NEXT-02).
 *
 * Glues the structured tool layer (migration 234) to the model. The router
 * calls `runToolLoop` to let Claude Sonnet ask for data via whitelisted
 * SECURITY DEFINER RPCs, then returns the final grounded answer + citations.
 *
 * Safety invariants:
 *   - Only tools in TOOL_REGISTRY (and optionally narrowed via
 *     `allowedToolNames`) are exposed to the model. Anything else → refusal.
 *   - The four caller-context parameters (organization_id, user_id, role,
 *     facility_ids) are injected by the loop on every RPC call; they are
 *     NEVER taken from model output.
 *   - PG error code P0001 from `_ai_tool_*` raises (role_denied,
 *     phi_blocked, facility_access_denied, family_not_linked) is captured
 *     and returned as a tool_result `{ error }` so the model can adapt
 *     (e.g. apologize without retrying the same blocked path).
 *   - Hard cap at `maxTurns` (default 5) prevents retry storms.
 *   - Each tool_use input is validated against the registry's JSON Schema
 *     before the RPC fires; defense in depth with the DB-side gate.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  TOOL_REGISTRY,
  getAnthropicToolDefs,
  getToolDescriptor,
  isAllowedTool,
  validateToolInput,
} from "../_shared/tool-registry.ts";
import { pickRedacted } from "../_shared/redact-pii.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ToolLoopCitation = {
  kind: "data_table";
  title: string;
  row_id?: string;
  source_table?: string;
};

export type ToolCallerContext = {
  organizationId: string;
  userId: string;
  role: string;
  facilityIds: string[];
};

export type ToolLoopArgs = {
  admin: SupabaseClient;
  systemPrompt: string;
  userQuestion: string;
  caller: ToolCallerContext;
  /** When provided, restricts the model to these tool names (whitelist). */
  allowedToolNames?: string[];
  /** Maximum tool-use turns before forcing a final answer. Default 5. */
  maxTurns?: number;
  /** Override model id (default claude-sonnet-4-6). */
  model?: string;
  /** Max output tokens per Claude call (default 1024). */
  maxTokensPerCall?: number;
};

export type ToolLoopResult = {
  answer: string;
  citations: ToolLoopCitation[];
  tokensIn: number;
  tokensOut: number;
  toolsUsed: string[];
  refusal?: boolean;
  refusalReason?: string;
  modelUsed: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TURNS = 5;
const DEFAULT_MAX_TOKENS = 1024;
const ANSWER_METADATA_INSTRUCTIONS = `After your visible answer, on a new line, output a JSON block:
<follow_ups>{"suggestions":["question 1","question 2","question 3"]}</follow_ups>
These should be natural next questions an executive would ask given your answer. Each suggestion must be 80 characters or fewer.

If your answer compares facilities, shows a trend, or aggregates by category, ALSO output:
<chart>{"kind":"bar"|"line"|"pie","series":[{"label":"...","value":N}],"x_label":"...","y_label":"..."}</chart>
Otherwise omit the chart block entirely.`;
const ANTHROPIC_TIMEOUT_MS = 60_000;
const RPC_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/*  Logging                                                            */
/* ------------------------------------------------------------------ */

/**
 * Known-safe keys for tool-loop logging. We deliberately whitelist instead of
 * spreading caller-supplied `extra` — that prevents unbounded log shapes and
 * stops accidental PHI from a Supabase error/payload from ever entering the
 * serialised line. Values are also deep-redacted via `pickRedacted`.
 */
const TOOL_LOG_WHITELIST = [
  "tool",
  "rpc",
  "classified",
  "status",
  "name",
  "msg",
  "turns",
  "tools_used",
  "run_id",
  "count",
  "error_code",
] as const;

function logEvent(event: string, extra: Record<string, unknown> = {}): void {
  const safe = pickRedacted(extra, TOOL_LOG_WHITELIST);
  console.log(JSON.stringify({ fn: "tool-loop", event, ...safe }));
}

function logError(event: string, error: unknown, extra: Record<string, unknown> = {}): void {
  const safe = pickRedacted(extra, TOOL_LOG_WHITELIST);
  console.error(
    JSON.stringify({
      fn: "tool-loop",
      event,
      outcome: "error",
      error_message: error instanceof Error ? error.message : String(error),
      ...safe,
    }),
  );
}

/* ------------------------------------------------------------------ */
/*  Anthropic message shapes (subset)                                  */
/* ------------------------------------------------------------------ */

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicResponse = {
  id?: string;
  stop_reason?: string;
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

/* ------------------------------------------------------------------ */
/*  Anthropic call                                                     */
/* ------------------------------------------------------------------ */

async function callAnthropicWithTools(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AnthropicMessage[];
  tools: ReturnType<typeof getAnthropicToolDefs>;
  maxTokens: number;
}): Promise<AnthropicResponse | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxTokens,
        system: `${args.systemPrompt}\n\n${ANSWER_METADATA_INSTRUCTIONS}`,
        tools: args.tools,
        messages: args.messages,
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      logError("anthropic_non_ok", new Error(text.slice(0, 240)), { status: res.status });
      return null;
    }
    return (await res.json()) as AnthropicResponse;
  } catch (err) {
    logError("anthropic_threw", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  RPC dispatch                                                       */
/* ------------------------------------------------------------------ */

type RpcOutcome =
  | { ok: true; data: unknown; toolName: string }
  | { ok: false; error: string; code?: string; toolName: string };

/**
 * Map PostgREST/PG error info to a stable string that the model can recognize.
 * P0001 is what `RAISE EXCEPTION 'role_denied'` etc. produces; the message
 * text from the migration RPCs is one of:
 *   role_denied | phi_blocked | facility_access_denied | family_not_linked
 */
function classifyRpcError(err: { code?: string; message?: string }): string {
  const msg = err.message ?? "";
  if (/role_denied/.test(msg)) return "role_denied";
  if (/phi_blocked/.test(msg)) return "phi_blocked";
  if (/facility_access_denied/.test(msg)) return "facility_access_denied";
  if (/family_not_linked/.test(msg)) return "family_not_linked";
  return err.code === "P0001" ? "rpc_rejected" : "rpc_failed";
}

async function callRpc(
  admin: SupabaseClient,
  toolName: string,
  rpcName: string,
  caller: ToolCallerContext,
  domainArgs: Record<string, unknown>,
): Promise<RpcOutcome> {
  // Caller context is injected on EVERY call. The model never supplies these.
  const params: Record<string, unknown> = {
    p_caller_organization_id: caller.organizationId,
    p_caller_user_id: caller.userId,
    p_caller_role: caller.role,
    p_caller_facility_ids: caller.facilityIds,
  };

  // Domain arg keys are mapped 1:1 to `p_<key>` to match RPC signatures.
  for (const [k, v] of Object.entries(domainArgs)) {
    params[`p_${k}`] = v;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    let result;
    try {
      result = await admin.rpc(rpcName, params).abortSignal(controller.signal);
    } finally {
      clearTimeout(timer);
    }
    const { data, error } = result;
    if (error) {
      const classified = classifyRpcError({
        code: (error as { code?: string }).code,
        message: error.message,
      });
      logError("rpc_error", error, { tool: toolName, rpc: rpcName, classified });
      return { ok: false, error: classified, code: (error as { code?: string }).code, toolName };
    }
    return { ok: true, data, toolName };
  } catch (err) {
    logError("rpc_threw", err, { tool: toolName, rpc: rpcName });
    return { ok: false, error: "rpc_failed", toolName };
  }
}

/* ------------------------------------------------------------------ */
/*  Citation extraction                                                */
/* ------------------------------------------------------------------ */

/**
 * Pull row IDs out of a tool_result JSON blob. Any object value (top-level or
 * inside an array property like `facilities`, `staff`, etc.) that has an `id`
 * uuid becomes a citation pointing at the descriptor's sourceTable.
 */
function extractCitationsFromResult(toolName: string, result: unknown): ToolLoopCitation[] {
  const desc = getToolDescriptor(toolName);
  if (!desc) return [];
  const out: ToolLoopCitation[] = [];

  const addRow = (row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    const rec = row as Record<string, unknown>;
    const id = rec.id;
    if (typeof id === "string") {
      out.push({
        kind: "data_table",
        title: toolName,
        row_id: id,
        source_table: desc.sourceTable,
      });
    }
  };

  if (Array.isArray(result)) {
    for (const r of result) addRow(r);
  } else if (result && typeof result === "object") {
    addRow(result);
    for (const v of Object.values(result as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        for (const r of v) addRow(r);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Main loop                                                          */
/* ------------------------------------------------------------------ */

export async function runToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
  const model = args.model ?? DEFAULT_MODEL;
  const maxTurns = Math.max(1, Math.min(args.maxTurns ?? DEFAULT_MAX_TURNS, 10));
  const maxTokensPerCall = args.maxTokensPerCall ?? DEFAULT_MAX_TOKENS;

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return {
      answer: "",
      citations: [],
      tokensIn: 0,
      tokensOut: 0,
      toolsUsed: [],
      refusal: true,
      refusalReason: "anthropic_key_missing",
      modelUsed: model,
    };
  }

  const allowed = (args.allowedToolNames ?? Object.keys(TOOL_REGISTRY)).filter(isAllowedTool);
  if (allowed.length === 0) {
    return {
      answer: "",
      citations: [],
      tokensIn: 0,
      tokensOut: 0,
      toolsUsed: [],
      refusal: true,
      refusalReason: "no_tools_allowed",
      modelUsed: model,
    };
  }

  const toolDefs = getAnthropicToolDefs(allowed);
  const messages: AnthropicMessage[] = [
    { role: "user", content: args.userQuestion },
  ];

  const citations: ToolLoopCitation[] = [];
  const toolsUsed = new Set<string>();
  let tokensIn = 0;
  let tokensOut = 0;
  let finalAnswer = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await callAnthropicWithTools({
      apiKey,
      model,
      systemPrompt: args.systemPrompt,
      messages,
      tools: toolDefs,
      maxTokens: maxTokensPerCall,
    });
    if (!resp) {
      return {
        answer: finalAnswer,
        citations,
        tokensIn,
        tokensOut,
        toolsUsed: [...toolsUsed],
        refusal: true,
        refusalReason: "model_unavailable",
        modelUsed: model,
      };
    }

    tokensIn += Number(resp.usage?.input_tokens ?? 0);
    tokensOut += Number(resp.usage?.output_tokens ?? 0);

    const content = resp.content ?? [];
    // Capture all text blocks emitted this turn; the LAST turn (no tool_use)
    // is what we return as the final answer.
    const textBits: string[] = [];
    const toolUses: AnthropicToolUseBlock[] = [];
    for (const block of content) {
      if (block.type === "text") textBits.push(block.text);
      else if (block.type === "tool_use") toolUses.push(block);
    }
    if (textBits.length > 0) finalAnswer = textBits.join("\n").trim();

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      logEvent("tool_loop_complete", { turns: turn + 1, tools_used: [...toolsUsed] });
      return {
        answer: finalAnswer,
        citations,
        tokensIn,
        tokensOut,
        toolsUsed: [...toolsUsed],
        modelUsed: model,
      };
    }

    // Echo the assistant turn (tool_use blocks) back to the conversation.
    messages.push({ role: "assistant", content });

    // Execute each tool_use sequentially; gather tool_result blocks.
    const toolResultBlocks: AnthropicToolResultBlock[] = [];
    for (const tu of toolUses) {
      if (!isAllowedTool(tu.name) || !allowed.includes(tu.name)) {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: "tool_not_allowed", name: tu.name }),
          is_error: true,
        });
        logEvent("tool_blocked", { name: tu.name });
        continue;
      }
      const desc = getToolDescriptor(tu.name)!;
      let validated: Record<string, unknown>;
      try {
        validated = validateToolInput(desc, tu.input);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: "invalid_input", message: msg }),
          is_error: true,
        });
        logEvent("tool_invalid_input", { name: tu.name, msg });
        continue;
      }

      const outcome = await callRpc(args.admin, tu.name, desc.rpc, args.caller, validated);
      toolsUsed.add(tu.name);

      if (!outcome.ok) {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: outcome.error }),
          is_error: true,
        });
        continue;
      }

      // Successful tool call: append citations and pass JSON to the model.
      const newCites = extractCitationsFromResult(tu.name, outcome.data);
      for (const c of newCites) citations.push(c);
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(outcome.data),
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  logEvent("tool_loop_max_turns_exhausted", { tools_used: [...toolsUsed] });
  return {
    answer:
      finalAnswer ||
      "I reached the tool-call limit without finishing your question. Please rephrase or ask a narrower follow-up.",
    citations,
    tokensIn,
    tokensOut,
    toolsUsed: [...toolsUsed],
    refusal: !finalAnswer,
    refusalReason: finalAnswer ? undefined : "max_turns_exhausted",
    modelUsed: model,
  };
}
