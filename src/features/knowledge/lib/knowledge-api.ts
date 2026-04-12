import { createClient } from "@/lib/supabase/client";

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  // Debug logging
  console.log("[Knowledge API Auth Debug]", {
    hasError: !!error,
    errorMessage: error?.message,
    hasSession: !!session,
    hasAccessToken: !!session?.access_token,
    expiresAt: session?.expires_at,
    nowSeconds: Math.floor(Date.now() / 1000),
    userId: session?.user?.id,
  });

  if (error) {
    return {
      Authorization: "",
      "Content-Type": "application/json",
    };
  }
  if (!session?.access_token) {
    return {
      Authorization: "",
      "Content-Type": "application/json",
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;

  // Refresh if token is expiring within 60 seconds OR if expiresAt is missing/invalid
  let accessToken = session.access_token;
  if (!expiresAt || expiresAt < nowSeconds + 60) {
    console.log("[Knowledge API Auth Debug] Attempting token refresh...", { expiresAt, nowSeconds });
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    console.log("[Knowledge API Auth Debug] Refresh result", {
      hasError: !!refreshError,
      errorMessage: refreshError?.message,
      hasNewSession: !!refreshed.session,
      hasNewToken: !!refreshed.session?.access_token,
    });
    if (!refreshError && refreshed.session?.access_token) {
      accessToken = refreshed.session.access_token;
    }
  }

  console.log("[Knowledge API Auth Debug] Returning auth headers", {
    hasAccessToken: !!accessToken,
    userId: session?.user?.id,
  });

  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

/** Result of non-streaming Edge Function calls (ingest, document-admin). */
export type EdgeCallResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number };

async function postEdgeJson(path: string, init: RequestInit): Promise<EdgeCallResult> {
  const base = getSupabaseUrl().replace(/\/$/, "");
  if (!base) {
    return { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL", status: 0 };
  }
  const res = await fetch(`${base}${path}`, init);
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
  const base = getSupabaseUrl().replace(/\/$/, "");
  if (!base) {
    return new Response(JSON.stringify({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const headers = await getAuthHeaders();
  return fetch(`${base}/functions/v1/knowledge-agent`, {
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
): Promise<EdgeCallResult> {
  const base = getSupabaseUrl().replace(/\/$/, "");
  if (!base) {
    return { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL", status: 0 };
  }
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", title);
  formData.append("audience", audience);
  formData.append("workspace_id", workspaceId);

  return postEdgeJson("/functions/v1/ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: formData,
  });
}

export async function reindexDocument(documentId: string): Promise<EdgeCallResult> {
  const headers = await getAuthHeaders();
  return postEdgeJson("/functions/v1/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({ document_id: documentId }),
  });
}

export async function adminUpdateDocument(
  documentId: string,
  updates: Record<string, unknown>,
): Promise<EdgeCallResult> {
  const headers = await getAuthHeaders();
  return postEdgeJson("/functions/v1/document-admin", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "update", document_id: documentId, ...updates }),
  });
}

export async function adminDeleteDocument(documentId: string): Promise<EdgeCallResult> {
  const headers = await getAuthHeaders();
  return postEdgeJson("/functions/v1/document-admin", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete", document_id: documentId }),
  });
}
