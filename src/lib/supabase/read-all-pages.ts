type Page<T> = { data: T[] | null; count: number | null; error: { message: string } | null };
/** Exact-count reconciliation; advance by actual rows so a lower hosted cap cannot truncate exports. */
export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<{ data: T[]; error: null }> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (;;) {
    const page = await fetchPage(rows.length, rows.length + 499);
    if (page.error) throw new Error(page.error.message);
    if (page.count === null) throw new Error('Exact row count unavailable. Retry before exporting.');
    expected ??= page.count;
    if (page.count !== expected) throw new Error('Records changed while loading. Reload before exporting.');
    if (rows.length < expected && !page.data?.length) throw new Error('Incomplete records returned. Retry before exporting.');
    rows.push(...(page.data ?? []));
    if (rows.length === expected) return { data: rows, error: null };
    if (rows.length > expected) throw new Error('Record count mismatch. Reload before exporting.');
  }
}
