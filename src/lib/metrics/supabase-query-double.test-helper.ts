import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type QueryDoubleReply = { data?: unknown; count?: number | null; error: { message: string } | null };

/**
 * Chainable Supabase double for loader tests: every builder method returns the
 * same query, and awaiting it resolves `answer(table, calls)`. `rpc` resolves
 * `answer("rpc:<name>", ...)`.
 */
export function supabaseQueryDouble(answer: (table: string, calls: unknown[][]) => QueryDoubleReply) {
  const makeQuery = (table: string) => {
    const calls: unknown[][] = [];
    const query: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (reply: QueryDoubleReply) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve().then(() => answer(table, calls)).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            calls.push([String(prop), ...args]);
            return query;
          };
        },
      },
    );
    return query;
  };
  const supabase = {
    from: (table: string) => makeQuery(table),
    rpc: (name: string, args?: unknown) => {
      const q = makeQuery(`rpc:${name}`) as Record<string, (...a: unknown[]) => unknown>;
      return q.args(args);
    },
  };
  return supabase as unknown as SupabaseClient<Database>;
}

export const isHeadCountQuery = (calls: unknown[][]) =>
  calls.some(
    ([method, , options]) => method === "select" && (options as { head?: boolean } | undefined)?.head === true,
  );
