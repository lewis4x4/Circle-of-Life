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

type SessionContextRow = {
  message_count: number | null;
  rolling_summary_text: string | null;
};

type MessageContextRow = {
  role: string;
  content: string | null;
  ordinal: number;
};

function normalizeMessage(row: MessageContextRow): ConversationTurn | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (!content) return null;
  return { role: row.role, content };
}

export async function loadConversationContext(
  admin: SupabaseClient,
  sessionId: string | null,
  organizationId: string,
  userId?: string,
): Promise<ConversationContext> {
  if (!sessionId) return { ...EMPTY_CONTEXT };

  let sessionQuery = admin
    .from("exec_nlq_sessions")
    .select("message_count, rolling_summary_text")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (userId) {
    sessionQuery = sessionQuery.or(
      `user_id.eq.${userId},shared_with_org.eq.true`,
    );
  }

  const { data: session, error: sessionError } = await sessionQuery
    .maybeSingle();

  if (sessionError || !session) return { ...EMPTY_CONTEXT };

  const row = session as SessionContextRow;
  const messageCount = typeof row.message_count === "number"
    ? row.message_count
    : 0;
  if (messageCount <= 0) return { ...EMPTY_CONTEXT };

  const fetchAll = messageCount <= 12;
  const recentLimit = messageCount <= 24 ? 6 : 4;
  const rollingSummary = messageCount > 24
    ? (row.rolling_summary_text?.trim() || null)
    : null;

  const baseQuery = admin
    .from("exec_nlq_messages")
    .select("role, content, ordinal")
    .eq("session_id", sessionId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("role", ["user", "assistant"]);

  const { data: messages, error: messagesError } = fetchAll
    ? await baseQuery.order("ordinal", { ascending: true })
    : await baseQuery.order("ordinal", { ascending: false }).limit(recentLimit);
  if (messagesError) {
    return { priorTurns: [], rollingSummary, messageCount };
  }

  const rows = (messages ?? []) as MessageContextRow[];
  const chronological = fetchAll ? rows : rows.reverse();

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
