import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
const ts = createRequire(`${process.cwd()}/package.json`)("typescript") as typeof import("typescript");
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(`${process.cwd()}/supabase/functions/export-audit-log/index.ts`, "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const job = { id: "job", organization_id: "org", requested_by: "actor", facility_id: null, date_from: null, date_to: null, status: "pending", format: "csv" };
const row = (index: number) => ({ id: String(index).padStart(5, "0"), table_name: "operation_task_instances", record_id: `permitted-task-${index}`, action: "UPDATE", user_id: "actor", organization_id: "org", facility_id: "site", created_at: "2026-09-09T12:00:00Z" });

function harness(options: { rows?: ReturnType<typeof row>[]; failPage?: number; revokeAtCheck?: number; failProfile?: boolean; truncated?: boolean; facilityId?: string; facilityAccess?: boolean; requestedBy?: string } = {}) {
  const rows = options.rows ?? [row(1)];
  const selectedJob = { ...job, facility_id: options.facilityId ?? null, requested_by: options.requestedBy ?? job.requested_by };
  let handler: (request: Request) => Promise<Response>;
  let page = 0;
  let check = 0;
  const updates: unknown[] = [];
  const queries: Array<{ table: string; filters: Record<string, unknown>; fields?: string }> = [];
  const from = vi.fn((table: string) => {
    const state: { table: string; filters: Record<string, unknown>; fields?: string; head?: boolean } = { table, filters: {} };
    queries.push(state);
    const result = async () => {
      if (table === "audit_log") {
        if (state.head) {
          check += 1;
          const ids = state.filters.id as unknown[] | undefined;
          return { data: null, count: options.revokeAtCheck === check ? 0 : ids?.length ?? rows.length, error: null };
        }
        page += 1;
        if (options.failPage === page) return { data: null, count: null, error: { message: "private policy detail" } };
        const remaining = rows.filter((r) => !state.filters.cursor || r.id > String(state.filters.cursor));
        return { data: options.truncated && page > 1 ? [] : remaining.slice(0, 500), count: remaining.length, error: null };
      }
      return { data: table === "user_profiles" ? (options.failProfile ? null : { id: "actor" }) : selectedJob, error: null };
    };
    const chain = {
      select(fields: string, config?: { head?: boolean }) { state.fields = fields; state.head = config?.head; return chain; },
      eq(key: string, value: unknown) { state.filters[key] = value; return chain; },
      is: () => chain, gte: () => chain, lte: () => chain, order: () => chain, limit: () => chain,
      gt(_key: string, value: unknown) { state.filters.cursor = value; return chain; },
      in(key: string, value: unknown) { state.filters[key] = value; return chain; },
      update(payload: unknown) { updates.push(payload); return chain; },
      maybeSingle: result, single: result,
      then(resolve: (value: unknown) => unknown) { return result().then(resolve); },
    };
    return chain;
  });
  const rpc = vi.fn(async (name: string) => ({ data: name === "haven_operation_facility_access" ? options.facilityAccess ?? true : true, error: null }));
  const client = { from, rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null }) } };
  const createClient = vi.fn(() => client);
  runInNewContext(compiled, {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => key } },
    createClient, corsHeaders: {}, jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    withTiming: () => ({ log: vi.fn() }), Response, TextEncoder, Uint8Array, crypto: webcrypto,
  });
  return { run: () => handler!(new Request("https://haven.test/export", { method: "POST", headers: { Authorization: "Bearer current-session" }, body: JSON.stringify({ job_id: "job" }) })), createClient, queries, updates, rpc };
}

describe("audit export current authority", () => {
  it("exports all 501 session-visible rows across pages with no service client or stored protected count", async () => {
    const h = harness({ rows: Array.from({ length: 501 }, (_, index) => row(index)) });
    const response = await h.run();
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.trim().split("\r\n")).toHaveLength(502);
    expect(csv).toContain("permitted-task-500");
    expect(h.createClient).toHaveBeenCalledExactlyOnceWith("SUPABASE_URL", "SUPABASE_ANON_KEY", { global: { headers: { Authorization: "Bearer current-session" } } });
    expect(h.rpc).toHaveBeenCalledWith("haven_complete_audit_export_job", { p_job_id: "job" });
    expect(h.updates).not.toContainEqual(expect.objectContaining({ row_count: 501 }));
    expect(h.queries.filter((q) => q.table === "audit_log").every((q) => !q.fields?.includes("old_data"))).toBe(true);
  });
  it("keeps facility exports confined to that exact site, including final checks", async () => {
    const facilityId = "11111111-1111-4111-8111-111111111111";
    const h = harness({ facilityId });
    expect((await h.run()).status).toBe(200);
    expect(h.queries.filter((q) => q.table === "audit_log" && q.fields !== "id").every((q) => q.filters.facility_id === facilityId)).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("haven_operation_facility_access", { p_facility_id: facilityId });
  });
  it("rejects a failed later page without emitting partial CSV or protected error detail", async () => {
    const h = harness({ rows: Array.from({ length: 501 }, (_, i) => row(i)), failPage: 2 });
    const response = await h.run();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Export failed" });
    expect(h.rpc).not.toHaveBeenCalledWith("haven_complete_audit_export_job", expect.anything());
  });
  it("rejects a truncated page instead of calling the first 500 records a complete export", async () => {
    const h = harness({ rows: Array.from({ length: 501 }, (_, i) => row(i)), truncated: true });
    expect((await h.run()).status).toBe(500);
  });
  it.each([1, 2])("rejects revocation during authorization check %i before completing the job or returning CSV", async (revokeAtCheck) => {
    const h = harness({ revokeAtCheck });
    expect((await h.run()).status).toBe(500);
    expect(h.rpc).not.toHaveBeenCalledWith("haven_complete_audit_export_job", expect.anything());
  });
  it("denies a facility export when the current site grant is gone, before completing the job", async () => {
    const h = harness({ facilityId: "11111111-1111-4111-8111-111111111111", facilityAccess: false });
    const response = await h.run();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Export failed" });
    expect(h.rpc).not.toHaveBeenCalledWith("haven_complete_audit_export_job", expect.anything());
  });
  it("refuses a job requested by a different user without reading any audit rows", async () => {
    const h = harness({ requestedBy: "someone-else" });
    const response = await h.run();
    expect(response.status).toBe(403);
    expect(h.queries.some((q) => q.table === "audit_log")).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("rechecks database actor authority for an empty export", async () => {
    const h = harness({ rows: [], failProfile: true });
    expect((await h.run()).status).toBe(500);
  });
});
