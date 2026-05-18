/**
 * Client-side Supabase (PostgREST) errors — log technical detail for debugging;
 * never surface raw SQL / Postgres strings to operators (Quiet Operator).
 */

export function logSupabasePostgrestError(
  scope: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  const base = { scope, ...meta };
  if (error && typeof error === "object") {
    const e = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };
    console.error("[haven][supabase]", {
      ...base,
      message: e.message,
      details: e.details,
      hint: e.hint,
      code: e.code,
    });
    return;
  }
  console.error("[haven][supabase]", { ...base, error });
}
