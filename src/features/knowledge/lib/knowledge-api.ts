import { authorizedEdgeFetch, requireVerifiedUserAccessToken } from "@/lib/supabase/edge-auth";

/** Result of non-streaming Edge Function calls (ingest, document-admin). */
export type EdgeCallResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number };

async function postEdgeJson(path: string, init: RequestInit): Promise<EdgeCallResult> {
  const functionName = path.split("/").pop();
  if (!functionName) {
    return { ok: false, error: "Invalid edge path", status: 0 };
  }
  const res = await authorizedEdgeFetch(functionName, init, "Knowledge API Auth Debug");
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { error: text.slice(0, 400) };
    }
  }
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const bodyError = obj && typeof obj.error === "string" && obj.error.length > 0 ? obj.error : "";
  if (!res.ok || bodyError) {
    return {
      ok: false,
      error: bodyError || `Request failed (${res.status})`,
      status: res.status,
    };
  }
  return { ok: true, data };
}

export interface SendChatMessageOptions {
  conversationId?: string;
  /** Maps to KB `workspace_id` (COL organization UUID). */
  workspaceId: string;
  signal?: AbortSignal;
}

export async function sendChatMessage(message: string, options: SendChatMessageOptions): Promise<Response> {
  return authorizedEdgeFetch(
    "knowledge-agent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        conversation_id: options.conversationId,
        workspace_id: options.workspaceId,
      }),
      signal: options.signal,
    },
    "Knowledge API Auth Debug",
  );
}

export async function uploadDocument(
  file: File,
  title: string,
  audience: string,
  workspaceId: string,
): Promise<EdgeCallResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("audience", audience);
  formData.append("workspace_id", workspaceId);

  return postEdgeJson("/functions/v1/ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${await requireVerifiedUserAccessToken("Knowledge API Auth Debug")}` },
    body: formData,
  });
}

export async function reindexDocument(documentId: string): Promise<EdgeCallResult> {
  return postEdgeJson("/functions/v1/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
}

export async function adminUpdateDocument(
  documentId: string,
  updates: Record<string, unknown>,
): Promise<EdgeCallResult> {
  return postEdgeJson("/functions/v1/document-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update", document_id: documentId, ...updates }),
  });
}

export async function adminDeleteDocument(documentId: string): Promise<EdgeCallResult> {
  return postEdgeJson("/functions/v1/document-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", document_id: documentId }),
  });
}
