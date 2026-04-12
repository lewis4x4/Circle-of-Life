"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  GraceExecuteResponse,
  GraceOrchestratorResponse,
  GraceUndoResponse,
} from "./types";

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

async function requireUserAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  // Debug logging
  console.log("[Grace Auth Debug]", {
    hasError: !!error,
    errorMessage: error?.message,
    hasSession: !!session,
    hasAccessToken: !!session?.access_token,
    expiresAt: session?.expires_at,
    nowSeconds: Math.floor(Date.now() / 1000),
    userId: session?.user?.id,
  });

  if (error) {
    throw new Error(`Grace auth: ${error.message}`);
  }
  if (!session?.access_token) {
    throw new Error("Grace: not signed in. Please reload the page and sign in again.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;

  // Refresh if token is expiring within 60 seconds OR if expiresAt is missing/invalid
  if (!expiresAt || expiresAt < nowSeconds + 60) {
    console.log("[Grace Auth Debug] Attempting token refresh...", { expiresAt, nowSeconds });
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    console.log("[Grace Auth Debug] Refresh result", {
      hasError: !!refreshError,
      errorMessage: refreshError?.message,
      hasNewSession: !!refreshed.session,
      hasNewToken: !!refreshed.session?.access_token,
    });
    if (refreshError || !refreshed.session?.access_token) {
      throw new Error("Grace: session expired and refresh failed. Please sign in again.");
    }
    return refreshed.session.access_token;
  }

  console.log("[Grace Auth Debug] Returning valid token", { userId: session.user.id });
  return session.access_token;
}

async function postGraceJson<T>(functionName: string, body: unknown): Promise<T> {
  const base = getSupabaseUrl().replace(/\/$/, "");
  if (!base) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  const accessToken = await requireUserAccessToken();
  const res = await fetch(`${base}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(text.slice(0, 300));
    }
  }

  if (!res.ok) {
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const message = typeof obj?.error === "string" ? obj.error : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export async function graceOrchestrate(input: {
  text: string;
  conversation_id?: string;
  input_mode?: "text" | "voice" | "hybrid";
  route?: string;
}): Promise<GraceOrchestratorResponse> {
  return await postGraceJson<GraceOrchestratorResponse>("grace-orchestrator", input);
}

export async function graceExecuteFlowStep(input: {
  flow_id: string;
  conversation_id: string;
  idempotency_key: string;
  slots: Record<string, unknown>;
  high_value_confirmation_cents?: number;
  client_slot_updated_at?: Record<string, string>;
}): Promise<GraceExecuteResponse> {
  return await postGraceJson<GraceExecuteResponse>("grace-execute-flow-step", input);
}

export async function graceUndoFlowRun(input: { run_id: string }): Promise<GraceUndoResponse> {
  return await postGraceJson<GraceUndoResponse>("grace-undo-flow-run", input);
}

export async function graceKnowledgeStream(input: {
  message: string;
  conversation_id?: string;
  organization_id: string;
  route?: string;
}): Promise<Response> {
  const base = getSupabaseUrl().replace(/\/$/, "");
  if (!base) {
    return new Response(JSON.stringify({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const accessToken = await requireUserAccessToken();
  return fetch(`${base}/functions/v1/knowledge-agent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: input.message,
      conversation_id: input.conversation_id,
      workspace_id: input.organization_id,
      route: input.route,
      grace: true,
    }),
  });
}
