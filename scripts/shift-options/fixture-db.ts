type Filter = { op: string; key: string; value: unknown };
class Query {
  filters: Filter[] = []; columns = "*";
  constructor(readonly table: string, readonly rpcArgs?: Record<string, unknown>) {}
  select(columns: string) { this.columns = columns; return this; }
  eq(key: string, value: unknown) { this.filters.push({ op: "eq", key, value }); return this; }
  is(key: string, value: unknown) { this.filters.push({ op: "is", key, value }); return this; }
  in(key: string, value: unknown) { this.filters.push({ op: "in", key, value }); return this; }
  gte(key: string, value: unknown) { this.filters.push({ op: "gte", key, value }); return this; }
  lte(key: string, value: unknown) { this.filters.push({ op: "lte", key, value }); return this; }
  order() { return this; }
  async read(from?: number, to?: number, single = false) {
    const response = await fetch("/__fixture/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: this.table, args: this.rpcArgs, filters: this.filters, columns: this.columns, from, to, single }) });
    return response.json();
  }
  range(from: number, to: number) { return this.read(from, to); }
  maybeSingle() { return this.read(undefined, undefined, true); }
  single() { return this.read(undefined, undefined, true); }
  then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.read().then(resolve, reject); }
}
export const isBrowserSupabaseConfigured = () => true;
export function createClient() {
  return {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Record<string, unknown>) => ["schedule_people_for_week", "schedule_assignment_intervals"].includes(name) ? new Query(name, args) : fetch("/__fixture/mutate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }) }).then((response) => response.json()),
    auth: { getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444", app_metadata: { app_role: "med_tech" } } }, error: null }) },
  };
}
