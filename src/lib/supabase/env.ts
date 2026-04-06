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
