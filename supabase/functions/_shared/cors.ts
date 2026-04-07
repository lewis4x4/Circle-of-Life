const ALLOWED_ORIGINS = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  let origin = "*";
  if (ALLOWED_ORIGINS.length > 0) {
    origin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret, x-dispatch-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/** Backwards-compatible default headers (falls back to * when env is unset) */
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
