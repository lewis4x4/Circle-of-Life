import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationContext = {
  priorTurns: ConversationTurn[];
  rollingSummary: string | null;
  messageCount: number;
};

const EMPTY_CONTEXT: ConversationContext = {
  priorTurns: [],
  rollingSummary: null,
  messageCount: 0,
};

type ConversationContextRpcData = {
  message_count?: unknown;
  rolling_summary_text?: unknown;
  messages?: unknown;
};

type MessageContextRow = {
  role: string;
  content: string | null;
  ordinal: number;
};

function normalizeRpcData(data: unknown): ConversationContextRpcData | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as ConversationContextRpcData;
}

function normalizeMessageRow(value: unknown): MessageContextRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.role !== "string") return null;
  return {
    role: row.role,
    content: typeof row.content === "string" ? row.content : null,
    ordinal: typeof row.ordinal === "number" ? row.ordinal : Number(row.ordinal),
  };
}

function normalizeMessage(row: MessageContextRow): ConversationTurn | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (!content) return null;
  return { role: row.role, content };
}

async function loadConversationContextRpc(
  admin: SupabaseClient,
  sessionId: string,
  organizationId: string,
  userId: string,
  limit: number,
): Promise<ConversationContextRpcData | null> {
  const { data, error } = await admin.rpc("get_nlq_conversation_context", {
    p_session_id: sessionId,
    p_org_id: organizationId,
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) return null;
  return normalizeRpcData(data);
}

export async function loadConversationContext(
  admin: SupabaseClient,
  sessionId: string | null,
  organizationId: string,
  userId?: string,
): Promise<ConversationContext> {
  if (!sessionId || !userId) return { ...EMPTY_CONTEXT };

  const countContext = await loadConversationContextRpc(
    admin,
    sessionId,
    organizationId,
    userId,
    0,
  );
  if (!countContext) return { ...EMPTY_CONTEXT };

  const messageCount = typeof countContext.message_count === "number"
    ? countContext.message_count
    : Number(countContext.message_count ?? 0);
  if (!Number.isFinite(messageCount) || messageCount <= 0) return { ...EMPTY_CONTEXT };

  const fetchLimit = messageCount <= 12 ? 12 : messageCount <= 24 ? 6 : 4;
  const context = await loadConversationContextRpc(
    admin,
    sessionId,
    organizationId,
    userId,
    fetchLimit,
  );
  if (!context) return { ...EMPTY_CONTEXT };

  const rollingSummary = messageCount > 24 && typeof context.rolling_summary_text === "string"
    ? (context.rolling_summary_text.trim() || null)
    : null;

  const chronological = Array.isArray(context.messages)
    ? context.messages.flatMap((row): MessageContextRow[] => {
      const normalized = normalizeMessageRow(row);
      return normalized ? [normalized] : [];
    })
    : [];

  return {
    priorTurns: chronological
      .map(normalizeMessage)
      .filter((turn): turn is ConversationTurn => turn !== null),
    rollingSummary,
    messageCount,
  };
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderConversationHistory(
  context: ConversationContext | null | undefined,
): string {
  if (!context) return "";
  const summary = context.rollingSummary?.trim() ?? "";
  const turns = context.priorTurns;
  if (!summary && turns.length === 0) return "";

  const parts = ["<conversation_history>"];
  if (summary) {
    parts.push(`<summary>${escapeXml(summary)}</summary>`);
  }
  for (const turn of turns) {
    parts.push(
      `<message role="${turn.role}">${escapeXml(turn.content)}</message>`,
    );
  }
  parts.push("</conversation_history>");
  return parts.join("\n");
}

export function prependConversationHistory(
  systemPrompt: string,
  context: ConversationContext | null | undefined,
): string {
  const history = renderConversationHistory(context);
  return history ? `${history}\n\n${systemPrompt}` : systemPrompt;
}
