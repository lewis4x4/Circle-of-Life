/**
 * Minimal chainable Supabase stand-in for loader tests. Every builder method
 * records itself and returns the chain; awaiting the chain calls `resolve`
 * with the table and the recorded calls, so a test can answer per query.
 */
export type FakeQueryCall = {
  table: string;
  ops: Array<[string, unknown[]]>;
  /** True when the select asked for a head count. */
  head: boolean;
};

export type FakeQueryResult = { data?: unknown; error?: unknown; count?: number | null };

export function fakeSupabase(resolve: (call: FakeQueryCall) => FakeQueryResult) {
  const calls: FakeQueryCall[] = [];
  const from = (table: string) => {
    const call: FakeQueryCall = { table, ops: [], head: false };
    calls.push(call);
    const chain: Record<string | symbol, unknown> = {};
    const proxy: unknown = new Proxy(chain, {
      get(_target, prop) {
        if (prop === "then") {
          const result = { data: null, error: null, count: null, ...resolve(call) };
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onFulfilled, onRejected);
        }
        return (...args: unknown[]) => {
          call.ops.push([String(prop), args]);
          if (prop === "select") {
            const opts = args[1] as { head?: boolean } | undefined;
            if (opts?.head) call.head = true;
          }
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { client: { from } as never, calls };
}

/** Whether a recorded call filtered `column` with `op` (e.g. "eq", "in"). */
export function hasFilter(call: FakeQueryCall, op: string, column: string): boolean {
  return call.ops.some(([name, args]) => name === op && args[0] === column);
}
