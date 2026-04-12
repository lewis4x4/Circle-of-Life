"use client";

import { createClient } from "@/lib/supabase/client";

function getSupabaseFunctionBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
}

function extractErrorMessage(payloadText: string): string {
  if (!payloadText) return "";
  try {
    const parsed = JSON.parse(payloadText) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? payloadText;
  } catch {
    return payloadText;
  }
}

async function refreshAccessToken(debugLabel: string): Promise<string> {
  const supabase = createClient();
  console.log(`[${debugLabel}] Refreshing access token...`);
  const { data: refreshed, error } = await supabase.auth.refreshSession();
  console.log(`[${debugLabel}] Refresh result`, {
    hasError: !!error,
    errorMessage: error?.message,
    hasSession: !!refreshed.session,
    hasAccessToken: !!refreshed.session?.access_token,
    userId: refreshed.session?.user?.id,
  });

  if (error || !refreshed.session?.access_token) {
    throw new Error("Session refresh failed. Please sign in again.");
  }

  return refreshed.session.access_token;
}

export async function requireVerifiedUserAccessToken(debugLabel: string): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  console.log(`[${debugLabel}] Session snapshot`, {
    hasError: !!error,
    errorMessage: error?.message,
    hasSession: !!session,
    hasAccessToken: !!session?.access_token,
    expiresAt: session?.expires_at,
    nowSeconds: Math.floor(Date.now() / 1000),
    userId: session?.user?.id,
  });

  if (error) {
    throw new Error(`${debugLabel}: ${error.message}`);
  }
  if (!session?.access_token) {
    throw new Error("Not signed in. Please reload the page and sign in again.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  if (!expiresAt || expiresAt < nowSeconds + 60) {
    return refreshAccessToken(debugLabel);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  console.log(`[${debugLabel}] User verification`, {
    hasError: !!userError,
    errorMessage: userError?.message,
    userId: user?.id,
  });

  if (userError || !user) {
    return refreshAccessToken(debugLabel);
  }

  const {
    data: { session: latestSession },
  } = await supabase.auth.getSession();

  return latestSession?.access_token ?? session.access_token;
}

export async function authorizedEdgeFetch(
  functionName: string,
  init: RequestInit,
  debugLabel: string,
): Promise<Response> {
  const base = getSupabaseFunctionBaseUrl();
  if (!base) {
    return new Response(JSON.stringify({ error: "Missing NEXT_PUBLIC_SUPABASE_URL" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const requestWithToken = async (token: string) => {
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${base}/functions/v1/${functionName}`, {
      ...init,
      headers,
    });
  };

  let token = await requireVerifiedUserAccessToken(debugLabel);
  let response = await requestWithToken(token);

  if (response.status === 401) {
    const payloadText = await response.clone().text();
    const message = extractErrorMessage(payloadText);
    console.warn(`[${debugLabel}] Edge function 401`, {
      functionName,
      message,
    });

    if (/invalid jwt/i.test(message)) {
      token = await refreshAccessToken(debugLabel);
      response = await requestWithToken(token);
    }
  }

  return response;
}
