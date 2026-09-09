/**
 * Shared checks for Supabase public env (browser + Node).
 * Keeps login and client fallbacks aligned with real project configuration.
 */
export function isSupabaseEnvConfigured(): boolean {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || "";
  if (!url || !key) return false;
  if (url.includes("dummy.supabase") || url.includes("YOUR_PROJECT_REF")) return false;
  if (key === "dummy-key" || key.toLowerCase().startsWith("your_supabase")) return false;
  return true;
}

/** 8-4-4-4-12 lowercase hex segments; matches Postgres `uuid` text including demo/seed IDs (not only RFC 4122 variant bits). */
export const UUID_STRING_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidFacilityIdForQuery(id: string | null): id is string {
  if (id == null) return false;
  return UUID_STRING_RE.test(id);
}

/** Exact CSP origins; plaintext transport is permitted only for local fixtures. */
export function supabaseCspOrigins(value: string | undefined): { http: string; websocket: string } {
  if (!value?.trim()) return { http: "", websocket: "" };
  const url = new URL(value);
  if (url.hostname.startsWith("[")) throw new Error("CSP does not support IPv6 literals; use localhost or 127.0.0.1 for local Supabase");
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Supabase requires HTTPS except for a loopback test endpoint");
  }
  return { http: url.origin, websocket: url.origin.replace(/^http/, "ws") };
}
