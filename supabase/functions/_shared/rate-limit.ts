/**
 * Simple in-memory rate limiter for Edge Functions.
 * Tracks requests per user ID with a sliding window.
 * Resets on Edge Function cold start (acceptable for cron + low-volume exec endpoints).
 */

const store = new Map<string, { count: number; windowStart: number }>();

const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

/**
 * Returns true if the request should be rate-limited (denied).
 * Returns false if the request is allowed.
 */
export function isRateLimited(
  userId: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  const now = Date.now();
  const entry = store.get(userId);

  if (!entry || now - entry.windowStart > windowMs) {
    store.set(userId, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    return true;
  }
  return false;
}
