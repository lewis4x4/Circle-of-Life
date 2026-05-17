/**
 * Simple in-memory rate limiter for Edge Functions.
 * Tracks requests per user ID (and, post-KB-NEXT-03, per org ID) with a
 * sliding window. Resets on Edge Function cold start (acceptable for cron +
 * low-volume exec endpoints).
 *
 * Keys are namespaced ("user:<id>" / "org:<id>") so the same store can hold
 * both without collision.
 */

const store = new Map<string, { count: number; windowStart: number }>();

const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_ORG_MAX_REQUESTS = 200;

/**
 * Returns true if the request should be rate-limited (denied).
 * Returns false if the request is allowed.
 */
export function isRateLimited(
  userId: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  return _check(`user:${userId}`, maxRequests, windowMs);
}

/**
 * Per-org sliding-window cap. Defaults to 200 req/min (loose enough to allow
 * normal usage but tight enough to stop a runaway script).
 */
export function isOrgRateLimited(
  orgId: string,
  maxRequests = DEFAULT_ORG_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  return _check(`org:${orgId}`, maxRequests, windowMs);
}

function _check(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    return true;
  }
  return false;
}
