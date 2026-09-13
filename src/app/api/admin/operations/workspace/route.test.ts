import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { GET } from "./route";
import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";

type Call = { method: string; args: unknown[] };
const results: Record<string, () => { data?: unknown; error?: unknown; count?: number | null }> = {};
const reads: Array<{ table: string; calls: Call[] }> = [];
const from = vi.fn((table: string) => {
  const calls: Call[] = [];
  reads.push({ table, calls });
  const result = () => {
    const isCount = (calls.find((call) => call.method === "select")?.args[1] as { head?: boolean } | undefined)?.head;
    const isLegacy = calls.some((call) => call.method === "is" && call.args[0] === "occurrence_kind");
    const response = (results[isCount ? `${table}:count` : isLegacy ? `${table}:legacy` : table] ?? (() => ({ data: [], error: null })))();
    const range = calls.find((call) => call.method === "range")?.args as [number, number] | undefined;
    return range && Array.isArray(response.data) ? { ...response, data: response.data.slice(range[0], range[1] + 1) } : response;
  };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "not", "in", "or", "gte", "lte", "lt", "order", "limit", "range"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result());
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled, onRejected);
  return chain;
});
const serviceFrom = vi.fn(() => {
  throw new Error("Service reads forbidden");
});
const actor = { id: "actor", organizationId: "org", appRole: "admin_assistant", currentActor: { id: "actor", fullName: "Sam Reyes", client: { from }, admin: { from: serviceFrom } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const get = (query: string) => GET(new NextRequest(`https://local.test/api/admin/operations/workspace${query}`) as never);

beforeEach(() => {
  // This fixture is due September 10; wall-clock drift must not move it to
  // the outstanding group and invalidate the session-client assertion.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-10T15:00:00Z"));
  vi.clearAllMocks();
  reads.length = 0;
  for (const key of Object.keys(results)) delete results[key];
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  results.facilities = () => ({ data: { id: facilityId, name: "Homewood Lodge", timezone: "America/New_York" }, error: null });
});

afterEach(() => vi.useRealTimers());

describe("workspace read", () => {
  it("refuses bad parameters before touching the site", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?facility_id=not-a-uuid")).status).toBe(400);
    expect((await get(`?facility_id=${facilityId}&view=yesterday`)).status).toBe(400);
    expect((await get(`?facility_id=${facilityId}&view=today&cursor=abc`)).status).toBe(400);
    expect((await get(`?facility_id=${facilityId}&view=history&cursor=`)).status).toBe(400);
    expect((await get(`?facility_id=${facilityId}&mine=yes`)).status).toBe(400);
    expect(actorCanAccessFacility).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("hides a site without a current grant before any read", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    const response = await get(`?facility_id=${facilityId}&view=today`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Facility not found" });
    expect(from).not.toHaveBeenCalled();
  });

  it("stops at the actor gate when the session does not qualify", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValue({ response: new Response(JSON.stringify({ error: "Insufficient role" }), { status: 403 }) } as never);
    expect((await get(`?facility_id=${facilityId}`)).status).toBe(403);
    expect(actorCanAccessFacility).not.toHaveBeenCalled();
  });

  it("composes today through the session client only and names the current person", async () => {
    results.operation_task_instances = () => ({ data: [{ id: occurrenceId, organization_id: "org", facility_id: facilityId, activity_id: "activity", subject_id: "subject", authority_class: "facility", template_name: "Generator test", assigned_shift_date: "2026-09-10", status: "pending", due_at: "2026-09-10T20:00:00+00:00", grace_ends_at: null, occurrence_kind: "scheduled", period_start_date: "2026-09-10", period_end_date: "2026-09-10", requirement_version_id: "11111111-1111-4111-8111-111111111111", facility_requirement_id: null, occurrence_revision: "a".repeat(64), execution_state: "none", effective_receipt_id: null, performed_at: null, created_at: "2026-09-01T00:00:00Z" }], error: null });
    results.operation_requirement_versions = () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", allowed_recorder_roles: ["admin_assistant"], review_required: false, required_inputs: [], required_evidence: [] }], error: null });
    const response = await get(`?facility_id=${facilityId}&view=today&mine=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ view: "today", facility_id: facilityId, facility_timezone: "America/New_York", partial: [], actor: { id: "actor", name: "Sam Reyes", role: "admin_assistant" } });
    expect(body.groups.due_today).toHaveLength(1);
    expect(body.groups.due_today[0]).toMatchObject({ occurrence: { id: occurrenceId, activity_name: "Generator test", subject_label: "Homewood Lodge" }, rules: { can_record: true, recorder_roles: ["admin_assistant"] }, receipt: null, open_issues: 0 });
    expect(body.groups).toMatchObject({ outstanding: [], unknown_schedule: [], legacy: [] });
    expect(serviceFrom).not.toHaveBeenCalled();
    expect(actorCanAccessFacility).toHaveBeenCalledWith(actor, facilityId);
  });

  it("returns history with a total from the count query and a cursor only when a page follows", async () => {
    results["operation_task_instances:count"] = () => ({ data: null, error: null, count: 7 });
    results.operation_task_instances = () => ({ data: [], error: null });
    const response = await get(`?facility_id=${facilityId}&view=history`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ view: "history", groups: { history: [], next_cursor: null, total: 7 }, partial: [] });
    expect((await get(`?facility_id=${facilityId}&view=history&cursor=%40%40`)).status).toBe(400);
  });

  it("answers 503 when the primary read fails and reports a failed sub-read as partial", async () => {
    results.operation_task_instances = () => ({ data: null, error: { message: "session revoked" } });
    const failed = await get(`?facility_id=${facilityId}&view=upcoming`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Workspace unavailable" });

    results.operation_task_instances = () => ({ data: [{ id: occurrenceId, organization_id: "org", facility_id: facilityId, activity_id: "activity", subject_id: "subject", authority_class: "asset", template_name: "Extinguisher check", assigned_shift_date: "2026-09-10", status: "pending", due_at: "2026-09-10T20:00:00+00:00", grace_ends_at: null, occurrence_kind: "scheduled", period_start_date: "2026-09-10", period_end_date: "2026-09-10", requirement_version_id: "11111111-1111-4111-8111-111111111111", facility_requirement_id: null, occurrence_revision: "a".repeat(64), execution_state: "none", effective_receipt_id: null, performed_at: null, created_at: "2026-09-01T00:00:00Z" }], error: null });
    results.operation_requirement_versions = () => ({ data: null, error: { message: "authorization stale" } });
    const partial = await get(`?facility_id=${facilityId}&view=upcoming`);
    expect(partial.status).toBe(200);
    const body = await partial.json();
    expect(body.partial).toEqual(["rules"]);
    expect(body.groups.upcoming[0]).toMatchObject({ occurrence: { id: occurrenceId }, rules: null });
    expect(JSON.stringify(body)).not.toContain("object_path");
  });
});
