/**
 * Supabase head counts (`select("id", { count: "exact", head: true })`) come
 * back as `{ count, error }`. `count` is null when the request failed, so
 * `count ?? 0` turns a failed read into "none" (COL-649 / COL-708). Use one of
 * these instead:
 *
 * - `headCountOrNull` when the caller renders a missing count honestly
 *   ("No … count posted", "Unavailable").
 * - `requireHeadCount` when a missing count should fail the whole read and
 *   surface the page's existing error state.
 */

export type HeadCountReply = { count?: number | null; error?: unknown };

export function headCountOrNull(reply: HeadCountReply): number | null {
  if (reply.error) return null;
  return typeof reply.count === "number" && Number.isFinite(reply.count) ? reply.count : null;
}

export function requireHeadCount(reply: HeadCountReply, what: string): number {
  if (reply.error) {
    const message =
      typeof reply.error === "object" && reply.error !== null && "message" in reply.error
        ? String((reply.error as { message: unknown }).message)
        : String(reply.error);
    throw new Error(`${what} count failed: ${message}`);
  }
  const count = headCountOrNull(reply);
  if (count === null) {
    throw new Error(`${what} count was not returned`);
  }
  return count;
}

/**
 * Sub-label for a count tile whose count may be missing: loading, unknown,
 * something to act on, or a real zero. Never the zero copy for a missing count.
 */
export function describeCountTile(
  value: number | null | undefined,
  ready: boolean,
  copy: { loading?: string; unavailable?: string; positive: string; zero: string },
): { subLabel: string; attention: boolean } {
  if (!ready) return { subLabel: copy.loading ?? "Loading count…", attention: false };
  if (value === null || value === undefined) {
    return { subLabel: copy.unavailable ?? "Count unavailable", attention: false };
  }
  return value > 0 ? { subLabel: copy.positive, attention: true } : { subLabel: copy.zero, attention: false };
}
