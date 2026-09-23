/**
 * A PostgREST head count is only a number when the read ran. `count ?? 0`
 * turns a failed or refused read into "none" (COL-649), so loaders take the
 * count through here instead:
 *
 *   - `requireHeadCount` throws, so the page's existing error state shows.
 *   - `headCountOrNull` returns null, for callers that render a MetricState
 *     ("Unavailable") per figure instead of failing the whole page.
 */
export type HeadCountResponse = { count: number | null; error?: unknown };

export function headCountOrNull(res: HeadCountResponse): number | null {
  if (res.error) return null;
  return typeof res.count === "number" && Number.isFinite(res.count) ? res.count : null;
}

export function requireHeadCount(res: HeadCountResponse, label: string): number {
  if (res.error) throw res.error instanceof Error ? res.error : new Error(`${label} count failed`);
  const n = headCountOrNull(res);
  if (n === null) throw new Error(`${label} count unavailable`);
  return n;
}
