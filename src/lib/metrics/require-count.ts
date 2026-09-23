/**
 * A Supabase head count that the caller cannot do without (COL-708).
 *
 * `count` is null when the request failed or did not run as a count. Reading
 * that as 0 turns "we could not count" into "there are none", so this throws
 * instead and the page's existing error state takes over. Use
 * `metricFromCount` from `./metric-state` when the slot should show
 * "Unavailable" on its own rather than failing the whole read.
 */
export function requireCount(
  res: { count: number | null | undefined; error?: unknown },
  what: string,
): number {
  if (res.error) throw res.error;
  if (typeof res.count !== "number" || !Number.isFinite(res.count)) {
    throw new Error(`${what}: count missing from the response`);
  }
  return res.count;
}
