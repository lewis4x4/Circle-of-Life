/** Normalize PostgREST / Supabase client errors into throwable Error instances. */
export function queryErrorMessage(error: unknown, context?: string): string {
  if (error instanceof Error) {
    return context ? `${context}: ${error.message}` : error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as { message: unknown }).message);
    return context ? `${context}: ${msg}` : msg;
  }
  const fallback = "Database query failed";
  return context ? `${context}: ${fallback}` : fallback;
}

export function throwIfQueryError(error: unknown, context?: string): asserts error is null | undefined {
  if (error) {
    throw new Error(queryErrorMessage(error, context));
  }
}
