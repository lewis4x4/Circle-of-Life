"use client";

import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
import type {
  GraceExecuteResponse,
  GraceOrchestratorResponse,
  GraceUndoResponse,
} from "./types";

async function postGraceJson<T>(functionName: string, body: unknown): Promise<T> {
  const res = await authorizedEdgeFetch(
    functionName,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Grace Auth Debug",
  );

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
  return authorizedEdgeFetch(
    "knowledge-agent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: input.message,
        conversation_id: input.conversation_id,
        workspace_id: input.organization_id,
        route: input.route,
        grace: true,
      }),
    },
    "Grace Auth Debug",
  );
}
