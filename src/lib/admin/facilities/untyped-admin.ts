type QueryError = { message: string };

export type QueryResult<T> = Promise<{
  data: T | null;
  error: QueryError | null;
  count?: number | null;
}>;

type UntypedQueryBuilder = QueryResult<Array<Record<string, unknown>>> & {
  select(columns?: string, options?: unknown): UntypedQueryBuilder;
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): UntypedQueryBuilder;
  update(values: Record<string, unknown>): UntypedQueryBuilder;
  delete(): UntypedQueryBuilder;
  eq(column: string, value: unknown): UntypedQueryBuilder;
  gt(column: string, value: unknown): UntypedQueryBuilder;
  gte(column: string, value: unknown): UntypedQueryBuilder;
  lte(column: string, value: unknown): UntypedQueryBuilder;
  in(column: string, values: readonly unknown[]): UntypedQueryBuilder;
  is(column: string, value: unknown): UntypedQueryBuilder;
  not(column: string, operator: string, value: string): UntypedQueryBuilder;
  or(filters: string): UntypedQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): UntypedQueryBuilder;
  range(from: number, to: number): UntypedQueryBuilder;
  limit(count: number): UntypedQueryBuilder;
  maybeSingle(): QueryResult<Record<string, unknown>>;
  single(): QueryResult<Record<string, unknown>>;
};

type UntypedStorageBucket = {
  upload(
    path: string,
    body: ArrayBuffer,
    options?: { contentType?: string },
  ): Promise<{ error: QueryError | null }>;
};

export type UntypedAdminClient = {
  from(table: string): UntypedQueryBuilder;
  storage: {
    from(bucket: string): UntypedStorageBucket;
  };
};

export function asUntypedAdmin<T>(admin: T): T & UntypedAdminClient {
  return admin as T & UntypedAdminClient;
}
