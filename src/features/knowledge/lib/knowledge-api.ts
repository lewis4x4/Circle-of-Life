import { createClient } from "@/lib/supabase/client";

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token ?? ""}`,
    "Content-Type": "application/json",
  };
}

export interface SendChatMessageOptions {
  conversationId?: string;
  /** Maps to KB `workspace_id` (COL organization UUID). */
  workspaceId: string;
  signal?: AbortSignal;
}

export async function sendChatMessage(message: string, options: SendChatMessageOptions): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(`${getSupabaseUrl()}/functions/v1/knowledge-agent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      conversation_id: options.conversationId,
      workspace_id: options.workspaceId,
    }),
    signal: options.signal,
  });
}

export async function uploadDocument(
  file: File,
  title: string,
  audience: string,
  workspaceId: string,
): Promise<unknown> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("audience", audience);
  formData.append("workspace_id", workspaceId);

  const res = await fetch(`${getSupabaseUrl()}/functions/v1/ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: formData,
  });
  return res.json();
}

export async function reindexDocument(documentId: string): Promise<unknown> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ document_id: documentId }),
  });
  return res.json();
}

export async function adminUpdateDocument(documentId: string, updates: Record<string, unknown>): Promise<unknown> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/document-admin`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "update", document_id: documentId, ...updates }),
  });
  return res.json();
}

export async function adminDeleteDocument(documentId: string): Promise<unknown> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/document-admin`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete", document_id: documentId }),
  });
  return res.json();
}
