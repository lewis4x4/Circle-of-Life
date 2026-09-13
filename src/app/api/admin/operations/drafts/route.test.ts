import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET, POST } from "./route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const limit = vi.fn();
const selects: string[] = [];
const queries: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
const from = vi.fn(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["eq", "is", "order"]) query[method] = vi.fn(() => query);
  query.select = vi.fn((columns: string) => { selects.push(columns); return query; });
  query.maybeSingle = maybeSingle;
  query.limit = limit;
  queries.push(query);
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const activityId = "11111111-1111-4111-8111-111111111111";
const subjectId = "44444444-4444-4444-8444-444444444444";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const draftId = "99999999-9999-4999-8999-999999999999";
const key = "record:2026-09-10:0001";
const post = (body: unknown) => new NextRequest("https://local.test/drafts", { method: "POST", body: JSON.stringify(body) });
const list = (query = "") => new NextRequest(`https://local.test/drafts${query}`);
const recordArguments = { payload: { outcome: "performed", values: { run_minutes: 12 } } };
const draftRow = { id: draftId, actor_id: "actor", command: "record_work", target_id: occurrenceId, request_key: key, state: "pending", expires_at: new Date(Date.now() + 3_600_000).toISOString(), arguments_hash: "h".repeat(64), actor_session_id: activityId };

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  selects.length = 0;
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" }, error: null });
  limit.mockResolvedValue({ data: [], error: null });
});

describe("save draft", () => {
  it("refuses a malformed body with the validation class before any read", async () => {
    const response = await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "failed" } } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "a failed outcome requires an issue", outcome: "validation" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect((await POST(new NextRequest("https://local.test/drafts", { method: "POST", body: "{" }))).status).toBe(400);
  });

  it("reads the occurrence through the session, requires a managed granted one, and forwards the draft payload with the target", async () => {
    rpc.mockResolvedValue({ data: { draft: draftRow, replayed: false }, error: null });
    const response = await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }));
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("operation_task_instances");
    expect(queries[0]?.is).toHaveBeenCalledWith("deleted_at", null);
    expect(actorCanAccessFacility).toHaveBeenCalledWith(actor, facilityId);
    expect(revalidateOperationsActor).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_operation_command_draft_review", { p_request_key: key, p_payload: { command: "record_work", target_id: occurrenceId, arguments: recordArguments } });
    // The fingerprint and the session are server-side material and never returned.
    const { arguments_hash: _hash, actor_session_id: _session, ...visible } = draftRow;
    void _hash;
    void _session;
    expect(await response.json()).toEqual({ draft: visible, replayed: false });
  });

  it("treats a legacy row, a foreign row, a missing row and an ungranted site as missing before the command", async () => {
    const body = { request_key: key, command: "verify_work", target_id: occurrenceId, arguments: { payload: { decision: "verified", receipt_id: subjectId, receipt_revision: "a".repeat(64) } } };
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: null }, error: null });
    expect((await POST(post(body))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "other", occurrence_kind: "scheduled" }, error: null });
    expect((await POST(post(body))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await POST(post(body))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await POST(post(body));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Occurrence not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    expect((await POST(post(body))).status).toBe(503);
  });

  it("scopes an issue report to its occurrence or to its site, sending the site only when there is no target", async () => {
    rpc.mockResolvedValue({ data: { draft: { ...draftRow, command: "report_issue" }, replayed: false }, error: null });
    const linked = { payload: { task_instance_id: occurrenceId, kind: "help_request", summary: "Need the generator key" } };
    expect((await POST(post({ request_key: key, command: "report_issue", arguments: linked }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("save_operation_command_draft_review", { p_request_key: key, p_payload: { command: "report_issue", target_id: occurrenceId, arguments: linked } });
    const scoped = { payload: { activity_id: activityId, facility_id: facilityId, subject_id: subjectId, kind: "problem", summary: "Leak" } };
    expect((await POST(post({ request_key: key, command: "report_issue", arguments: scoped }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("save_operation_command_draft_review", { p_request_key: key, p_payload: { command: "report_issue", facility_id: facilityId, arguments: scoped } });
    expect(from).toHaveBeenCalledTimes(1);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const ungranted = await POST(post({ request_key: key, command: "report_issue", arguments: scoped }));
    expect(ungranted.status).toBe(404);
    expect(await ungranted.json()).toEqual({ error: "Facility not found", outcome: "missing" });
  });

  it("stops before the command when the actor no longer revalidates", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    expect((await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a replay as the same draft, a changed replay as a conflict and another actor's key as unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: { draft: draftRow, replayed: true }, error: null });
    expect((await (await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }))).json()).replayed).toBe(true);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    const conflict = await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "This request was already saved with different content", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    const denied = await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
  });

  it("returns the uncertain class without echoing internal detail, and never claims a draft without one", async () => {
    const sentinel = "relation public.operation_command_drafts deadlock detected";
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01", message: sentinel } });
    const response = await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.outcome).toBe("uncertain");
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith("admin.operations.drafts.save", expect.objectContaining({ message: sentinel }), { action: "rpc", command: "record_work" });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const shapeless = await POST(post({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: recordArguments }));
    expect(shapeless.status).toBe(500);
    expect(await shapeless.json()).toEqual({ error: "Draft could not be confirmed; nothing was saved", outcome: "uncertain" });
  });
});

describe("list own drafts", () => {
  it("lists the caller's own pending drafts newest first, at most fifty, without arguments", async () => {
    limit.mockResolvedValueOnce({ data: [draftRow], error: null });
    const response = await GET(list("?state=pending"));
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("operation_command_drafts");
    const query = queries[0]!;
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(query.eq).toHaveBeenCalledWith("actor_id", "actor");
    expect(query.eq).toHaveBeenCalledWith("state", "pending");
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
    expect(selects[0]).not.toContain("arguments");
    const body = await response.json();
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0]).not.toHaveProperty("arguments_hash");
    expect(body.drafts[0]).not.toHaveProperty("actor_session_id");
    expect(body.drafts[0].state).toBe("pending");
  });

  it("lists reconciled, discarded and expired drafts on request", async () => {
    for (const state of ["reconciled", "discarded", "expired"]) {
      queries.length = 0;
      limit.mockResolvedValueOnce({ data: [{ ...draftRow, state, expires_at: new Date(Date.now() - 1000).toISOString() }], error: null });
      const response = await GET(list(`?state=${state}`));
      expect(response.status).toBe(200);
      expect(queries[0]?.eq).toHaveBeenCalledWith("state", state);
      expect(queries[0]?.eq).toHaveBeenCalledWith("actor_id", "actor");
      // Only a pending draft is re-read as expired; settled states are reported as stored.
      expect((await response.json()).drafts[0].state).toBe(state);
    }
  });

  it("defaults to pending, refuses an unknown state and reads a pending draft past expiry as expired", async () => {
    await GET(list());
    expect(queries[0]?.eq).toHaveBeenCalledWith("state", "pending");
    expect((await GET(list("?state=archived"))).status).toBe(400);
    limit.mockResolvedValueOnce({ data: [{ ...draftRow, expires_at: new Date(Date.now() - 1000).toISOString() }], error: null });
    expect((await (await GET(list())).json()).drafts[0].state).toBe("expired");
    limit.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    expect((await GET(list())).status).toBe(503);
  });
});
