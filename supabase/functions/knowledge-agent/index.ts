/**
 * Knowledge Base — Claude tool-use agent with semantic_kb_search + SSE streaming.
 * Auth: user JWT.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL_FULL = "claude-sonnet-4-6";
const MODEL_REDUCED = "claude-haiku-4-5-20251001";
const MAX_ITERATIONS = 6;
const MAX_HISTORY = 12;
const SOFT_CAP_TOKENS = 50_000;
const HARD_CAP_TOKENS = 150_000;

const TOOL_DEFINITIONS = [
  {
    name: "semantic_kb_search",
    description:
      "Search the knowledge base for documents, policies, procedures, and operational data. Use for any question about company knowledge.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
      },
      required: ["query"],
    },
  },
];

const CACHED_TOOLS = TOOL_DEFINITIONS.map((t, i) =>
  i === TOOL_DEFINITIONS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
);

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  admin: any, // KB tables not in generated client schema yet
  workspaceId: string,
  userRole: string,
): Promise<unknown> {
  switch (name) {
    case "semantic_kb_search": {
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: input.query as string,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!embRes.ok) {
        const errText = await embRes.text();
        return { error: `Embedding API ${embRes.status}: ${errText.slice(0, 500)}` };
      }
      const embData = await embRes.json();
      const embedding = embData?.data?.[0]?.embedding as number[] | undefined;
      if (!embedding?.length) {
        return { error: "Embedding API returned no vector" };
      }

      const { data, error } = await admin.rpc("retrieve_evidence", {
        query_embedding: `[${embedding.join(",")}]`,
        keyword_query: input.query as string,
        user_role: userRole,
        match_count: 8,
        semantic_threshold: 0.45,
        p_workspace_id: workspaceId,
      });

      if (error) return { error: error.message };

      const rows = (data ?? []) as {
        source_title: string;
        excerpt: string;
        confidence: number;
        section_title: string | null;
      }[];

      if (rows.length > 3) {
        return await rerankResults(rows, input.query as string);
      }

      return rows;
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function rerankResults(
  results: {
    source_title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[],
  query: string,
): Promise<typeof results> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Given the query "${query}", rank these search results from most to least relevant. Return ONLY a JSON array of indices (0-based), most relevant first. No explanation.\n\nResults:\n${results.map((r, i) => `[${i}] ${r.source_title}: ${r.excerpt?.slice(0, 200)}`).join("\n")}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return results;
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    const indices = JSON.parse(text) as unknown;
    if (Array.isArray(indices)) {
      return indices.map((i: number) => results[i]).filter(Boolean);
    }
  } catch {
    /* fallback */
  }
  return results;
}

function buildSystemPrompt(): string {
  return `You are the knowledge assistant for Circle of Life assisted living facility. You answer questions by USING YOUR TOOLS — you have direct database access.

How to think:
1. Read the question.
2. Pick the right tool. For knowledge/policies/procedures → semantic_kb_search. For app-specific data → use the relevant tool.
3. Call the tool. Read the result.
4. If you need more info, call another tool.
5. When you have enough, write a concise, direct answer.

Hard rules:
- All tools are READ-ONLY. No mutations.
- Never invent data. If a tool returns no results, say so and suggest next steps.
- Cite sources inline when drawing from semantic_kb_search results.
- Use markdown formatting when it helps readability.
- CRITICAL: Respect role-based access. You only see documents the user's role permits.`;
}

async function runAgentLoop(
  question: string,
  conversationHistory: { role: string; content: unknown }[],
  admin: any, // KB tables not in generated client schema yet
  workspaceId: string,
  userRole: string,
  _userId: string,
): Promise<{
  text: string;
  sources: {
    title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[];
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}> {
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let model = MODEL_FULL;
  const toolsUsed: string[] = [];
  const sources: {
    title: string;
    excerpt: string;
    confidence: number;
    section_title: string | null;
  }[] = [];

  const messages: Array<{ role: string; content: unknown }> = [
    ...conversationHistory.slice(-MAX_HISTORY),
    { role: "user", content: question },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (totalTokensIn + totalTokensOut > SOFT_CAP_TOKENS) {
      model = MODEL_REDUCED;
    }
    if (totalTokensIn + totalTokensOut > HARD_CAP_TOKENS) {
      break;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
        tools: CACHED_TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API ${response.status}: ${errText}`);
    }

    const result = await response.json();
    totalTokensIn += result.usage?.input_tokens ?? 0;
    totalTokensOut += result.usage?.output_tokens ?? 0;

    if (result.stop_reason === "end_turn") {
      const textBlock = result.content.find((b: { type: string }) => b.type === "text");
      return {
        text: textBlock?.text ?? "I wasn't able to generate a response.",
        sources,
        toolsUsed,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        model,
      };
    }

    if (result.stop_reason === "tool_use") {
      const assistantMessage = { role: "assistant", content: result.content };
      messages.push(assistantMessage);

      const toolResults: unknown[] = [];
      for (const block of result.content as { type: string; name?: string; id?: string; input?: Record<string, unknown> }[]) {
        if (block.type !== "tool_use") continue;

        toolsUsed.push(block.name!);
        const toolResult = await executeTool(block.name!, block.input ?? {}, admin, workspaceId, userRole);

        if (block.name === "semantic_kb_search" && Array.isArray(toolResult)) {
          sources.push(
            ...toolResult.map((r: { source_title: string; excerpt: string; confidence: number; section_title: string | null }) => ({
              title: r.source_title,
              excerpt: r.excerpt,
              confidence: r.confidence,
              section_title: r.section_title,
            })),
          );
        }

        const resultStr = JSON.stringify(toolResult);
        const truncated = resultStr.length > 8192 ? resultStr.slice(0, 8192) + "..." : resultStr;

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: truncated,
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return {
    text: "I reached my maximum number of search iterations. Please try rephrasing your question.",
    sources,
    toolsUsed,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    model,
  };
}

Deno.serve(async (req) => {
  const t = withTiming("knowledge-agent");
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

  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();

  const userRole = profile?.app_role ?? "caregiver";
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }

  let body: { message?: string; conversation_id?: string; workspace_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const { message, conversation_id, workspace_id: bodyWorkspaceId } = body;

  if (!message?.trim()) {
    return jsonResponse({ error: "Message required" }, 400, origin);
  }

  const workspaceId = bodyWorkspaceId && bodyWorkspaceId === orgId ? bodyWorkspaceId : orgId;
  const traceId = crypto.randomUUID();

  let conversationId = conversation_id;
  if (!conversationId) {
    const { data: conv, error: convErr } = await admin
      .from("chat_conversations")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        title: message.slice(0, 100),
      })
      .select("id")
      .single();
    if (convErr || !conv?.id) {
      t.log({ event: "conv_create_failed", outcome: "error", error_message: convErr?.message });
      return jsonResponse({ error: "Could not create conversation" }, 500, origin);
    }
    conversationId = conv.id;
  } else {
    const { data: existingConv, error: convLookupErr } = await admin
      .from("chat_conversations")
      .select("id, user_id, workspace_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convLookupErr || !existingConv) {
      t.log({ event: "conv_not_found", outcome: "blocked", conversation_id: conversationId });
      return jsonResponse({ error: "Conversation not found" }, 404, origin);
    }
    if (existingConv.user_id !== user.id) {
      t.log({ event: "conv_forbidden_user", outcome: "blocked", conversation_id: conversationId });
      return jsonResponse({ error: "Forbidden" }, 403, origin);
    }
    if (existingConv.workspace_id !== workspaceId) {
      t.log({ event: "conv_forbidden_org", outcome: "blocked", conversation_id: conversationId });
      return jsonResponse({ error: "Forbidden" }, 403, origin);
    }
  }

  let history: { role: string; content: unknown }[] = [];
  if (conversationId) {
    const { data: msgs } = await admin
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(MAX_HISTORY);
    history = (msgs ?? []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              meta: { trace_id: traceId, conversation_id: conversationId, model: MODEL_FULL },
            })}\n\n`,
          ),
        );

        const result = await runAgentLoop(message, history, admin, workspaceId, userRole, user.id);

        const sentences = result.text.match(/[^.!?]+[.!?]+\s*/g) || [result.text];
        for (const sentence of sentences) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: sentence })}\n\n`));
        }

        if (result.sources.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources: result.sources })}\n\n`));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        void admin.from("chat_messages").insert([
          {
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: user.id,
            role: "user",
            content: message,
            trace_id: traceId,
          },
          {
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: user.id,
            role: "assistant",
            content: result.text,
            sources: result.sources.length > 0 ? result.sources : null,
            classifier_output: {
              model: result.model,
              tools_used: result.toolsUsed,
              iterations: result.toolsUsed.length,
            },
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
            model: result.model,
            trace_id: traceId,
          },
        ]);

        void admin.rpc("increment_usage", {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
          p_tokens_in: result.tokensIn,
          p_tokens_out: result.tokensOut,
        });

        if (result.sources.length === 0) {
          void admin.rpc("log_knowledge_gap", {
            p_workspace_id: workspaceId,
            p_user_id: user.id,
            p_question: message,
            p_trace_id: traceId,
          });
        }

        void admin.from("kb_analytics_events").insert({
          workspace_id: workspaceId,
          event_type: "chat_query",
          user_id: user.id,
          metadata: {
            trace_id: traceId,
            tools_used: result.toolsUsed,
            source_count: result.sources.length,
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
          },
        });

        t.log({ event: "chat_ok", outcome: "success", trace_id: traceId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        t.log({ event: "chat_error", outcome: "error", error_message: msg });

        void admin.from("chat_messages").insert([
          {
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: user.id,
            role: "user",
            content: message,
            trace_id: traceId,
          },
          {
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: user.id,
            role: "assistant",
            content: `Error: ${msg}`,
            trace_id: traceId,
          },
        ]);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...getCorsHeaders(origin),
    },
  });
});
