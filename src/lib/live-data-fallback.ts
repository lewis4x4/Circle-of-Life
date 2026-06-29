import { queryErrorMessage } from "@/lib/supabase/query-error";

const LIVE_DATA_FALLBACK =
  "Live data is unavailable right now. Try again, or contact support if this persists.";

/** Operator-safe message with optional dev detail for AdminLiveDataFallbackNotice. */
export function formatLiveDataLoadError(
  error: unknown,
  fallbackMessage: string = LIVE_DATA_FALLBACK,
): string {
  const detail = queryErrorMessage(error);
  console.error("[Haven] live data load failed:", detail, error);
  if (process.env.NODE_ENV === "development" && detail) {
    return `${fallbackMessage} (${detail})`;
  }
  return fallbackMessage;
}
