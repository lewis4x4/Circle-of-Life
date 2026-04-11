const ALLOWED_ORIGINS = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret, x-dispatch-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };

  if (ALLOWED_ORIGINS.length === 0) {
    return requestOrigin
      ? {
          ...headers,
          "Access-Control-Allow-Origin": requestOrigin,
        }
      : headers;
  }

  const origin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin,
  };
}

/** When no allowlist is configured, reflect the request origin for browser clients. */
export const corsHeaders = getCorsHeaders();

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  requestOrigin?: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(requestOrigin), "Content-Type": "application/json" },
  });
}
