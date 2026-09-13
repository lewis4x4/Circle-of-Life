export const OPERATIONS_READ_PAGE_SIZE = 500;

export type ReadResult<T> = { data: T | null; error: { message?: string } | null };

/** Advance by the returned size and stop only on empty, even if the provider cap is below our range. */
export async function readAllOperationRows<T>(query: () => unknown, maxRows = Infinity): Promise<ReadResult<T[]>> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const page = await (query() as { range(from: number, to: number): PromiseLike<ReadResult<T[]>> }).range(rows.length, Math.min(rows.length + OPERATIONS_READ_PAGE_SIZE, maxRows) - 1);
    if (page.error) return { data: null, error: page.error };
    const batch = page.data ?? [];
    if (batch.length === 0) return { data: rows, error: null };
    rows.push(...batch);
  }
  return { data: rows, error: null };
}
