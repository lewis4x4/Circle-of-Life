type Page<T> = { data: T[] | null; count: number | null; error: { message: string } | null };
/**
 * Exact-count reconciliation; advance by actual rows so a lower hosted cap cannot truncate exports.
 * Once the first page names the total, the remaining pages are read at once (COL-674), stepping by
 * the rows the server actually returned, and every page must still report the same total.
 */
export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<{ data: T[]; error: null }> {
  const rows: T[] = [];
  let expected: number | null = null;
  const accept = (page: Page<T>) => {
    if (page.error) throw Object.assign(new Error(page.error.message), page.error);
    if (page.count === null) throw new Error('Exact row count unavailable. Retry before exporting.');
    expected ??= page.count;
    if (page.count !== expected) throw new Error('Records changed while loading. Reload before exporting.');
    if (rows.length < expected && !page.data?.length) throw new Error('Incomplete records returned. Retry before exporting.');
    rows.push(...(page.data ?? []));
    if (rows.length > expected) throw new Error('Record count mismatch. Reload before exporting.');
  };

  accept(await fetchPage(0, 499));
  if (rows.length === expected) return { data: rows, error: null };
  const stride = rows.length;
  const offsets: number[] = [];
  for (let from = stride; from < (expected ?? 0); from += stride) offsets.push(from);
  const pages = await Promise.all(offsets.map((from) => fetchPage(from, from + stride - 1)));
  for (const page of pages) accept(page);
  for (;;) {
    if (rows.length === expected) return { data: rows, error: null };
    accept(await fetchPage(rows.length, rows.length + 499));
  }
}
