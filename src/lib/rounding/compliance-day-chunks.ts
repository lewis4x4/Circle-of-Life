/**
 * Chunked reads of `public.observation_compliance_for_range`.
 *
 * The function runs with invoker rights on purpose (see the compliance route),
 * so under a signed-in caller every row passes through RLS. Before migration
 * 474 that cost ~1.7 s per day for one 34-resident building (seven days ~6.8 s
 * as `authenticated`, 0.26 s as `postgres`) against an 8 s statement_timeout,
 * so COL-646 read one service date per statement. Migration 474 (COL-664)
 * evaluates the RLS helpers once per statement and projects windows once per
 * facility-day: seven days now take ~0.36 s and thirty-one ~0.71 s on
 * production. Reads still go in bounded chunks (every page of a paginated read
 * re-runs the whole chunk, and a year-long range should not be one statement);
 * rows are keyed by service_date, so the union of the chunks is the range.
 */

/** Service dates per `observation_compliance_for_range` call. */
export const COMPLIANCE_CHUNK_DAYS = 7;

/** Calendar dates from `from` to `to` inclusive (YYYY-MM-DD, no time zone arithmetic). */
function calendarDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? Number.NaN, (month ?? Number.NaN) - 1, day ?? Number.NaN));
  if (Number.isNaN(date.getTime())) throw new Error("from and to must be calendar dates");
  return date;
}

export function complianceServiceDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = calendarDate(from);
  const end = calendarDate(to);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Consecutive inclusive `{ from, to }` date spans covering `from`..`to`, each at most `days` long. */
export function complianceDateChunks(from: string, to: string, days: number = COMPLIANCE_CHUNK_DAYS): { from: string; to: string }[] {
  const dates = complianceServiceDates(from, to);
  const size = Math.max(1, Math.floor(days));
  const chunks: { from: string; to: string }[] = [];
  for (let i = 0; i < dates.length; i += size) {
    const span = dates.slice(i, i + size);
    chunks.push({ from: span[0] as string, to: span[span.length - 1] as string });
  }
  return chunks;
}

/** Runs `task` over `items` with at most `limit` in flight; results keep input order. Rejects on the first failure. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
