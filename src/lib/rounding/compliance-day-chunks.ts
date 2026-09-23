/**
 * Day-by-day reads of `public.observation_compliance_for_range`.
 *
 * The function runs with invoker rights on purpose (see the compliance route),
 * so under a signed-in caller every row passes through RLS. Measured on hosted
 * Haven 2026-09-22 for one 34-resident building: one day ~1.7 s, seven days
 * ~6.8 s as `authenticated` (0.26 s as `postgres`). `authenticated` has an 8 s
 * statement_timeout, and every page of a paginated seven-day read re-runs the
 * whole range, so the range read died with 57014 and the route answered 500.
 * One call per service date keeps each statement to a single day; rows are
 * keyed by service_date, so the union of the days is the range.
 */

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
