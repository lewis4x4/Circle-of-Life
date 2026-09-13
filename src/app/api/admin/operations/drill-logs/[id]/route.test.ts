import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST as COMMAND } from "./route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const isCalls: Array<[string, unknown]> = [];
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.is = vi.fn((column: string, value: unknown) => { isCalls.push([column, value]); return query; });
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "facility_admin", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const drillId = "99999999-9999-4999-8999-999999999999";
const key = "drill:2026-09-10:0001";
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const outcome = {
  record: { id: drillId, record_version: 2, facility_id: facilityId, drill_type: "fire", finalized_at: "2026-09-10T18:05:00Z" },
  delivery: {
    event: { id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false, request_hash: "f".repeat(64) },
    occurrence: { id: "55555555-5555-4555-8555-555555555555", status: "in_progress", execution_state: "awaiting_verification" },
    receipt: { id: "77777777-7777-4777-8777-777777777777", request_hash: "f".repeat(64), completion_state: "awaiting_verification" },
    candidates: ["55555555-5555-4555-8555-555555555555"],
    replayed: false,
  },
  linked: true,
  replayed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  isCalls.length = 0;
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: drillId, facility_id: facilityId, organization_id: "org" }, error: null });
});

describe("finalize, correct or void a drill log", () => {
  it("refuses a bad id, a malformed body and an unreadable, deleted, foreign or unheld drill log before the command", async () => {
    const finalize = { request_key: key, action: "finalize", payload: {} };
    expect((await COMMAND(post("https://local.test/d", finalize), params("nope"))).status).toBe(404);
    const malformed = await COMMAND(post("https://local.test/d", { request_key: key, action: "correct", payload: { reason: "x" } }), params(drillId));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).outcome).toBe("validation");
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await COMMAND(post("https://local.test/d", finalize), params(drillId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { id: drillId, facility_id: facilityId, organization_id: "other" }, error: null });
    expect((await COMMAND(post("https://local.test/d", finalize), params(drillId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await COMMAND(post("https://local.test/d", finalize), params(drillId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await COMMAND(post("https://local.test/d", finalize), params(drillId))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    // The read excludes soft-deleted drafts.
    expect(isCalls).toContainEqual(["deleted_at", null]);
  });

  it("forwards finalize, correct and void to their commands and returns the record with its link verdict", async () => {
    rpc.mockResolvedValueOnce({ data: outcome, error: null });
    let response = await COMMAND(post("https://local.test/d", { request_key: key, action: "finalize", payload: { entry_reason: "Logged after the debrief" } }), params(drillId));
    expect(response.status).toBe(200);
    expect(revalidateOperationsActor).toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("finalize_drill_log_review", { p_id: drillId, p_request_key: key, p_payload: { entry_reason: "Logged after the debrief" } });
    let json = await response.json();
    expect(json.outcome).toBe("record");
    expect(json.linked).toBe(true);
    expect(json.delivery.receipt).toEqual({ id: "77777777-7777-4777-8777-777777777777", completion_state: "awaiting_verification" });
    rpc.mockResolvedValueOnce({ data: outcome, error: null });
    response = await COMMAND(post("https://local.test/d", { request_key: key, action: "correct", expected_version: 2, payload: { reason: "Count corrected", residents_present_count: 21 } }), params(drillId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("correct_drill_log_review", { p_id: drillId, p_request_key: key, p_expected_version: 2, p_payload: { reason: "Count corrected", residents_present_count: 21 } });
    rpc.mockResolvedValueOnce({ data: { ...outcome, delivery: null, linked: false, link_reason: "no_checklist_activity" }, error: null });
    response = await COMMAND(post("https://local.test/d", { request_key: key, action: "void", payload: { reason: "False alarm response" } }), params(drillId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("void_drill_log_review", { p_id: drillId, p_request_key: key, p_payload: { reason: "False alarm response" } });
    json = await response.json();
    expect(json).toEqual({ outcome: "record", record: outcome.record, delivery: null, linked: false, replayed: false, link_reason: "no_checklist_activity" });
  });

  it("maps an unstated late entry as validation, an already-final or draft log as a conflict, a stale version with its current one, and uncertainty", async () => {
    const finalize = { request_key: key, action: "finalize", payload: {} };
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Work performed earlier than fifteen minutes ago must be entered as late with a reason" } });
    let response = await COMMAND(post("https://local.test/d", finalize), params(drillId));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Work performed earlier than fifteen minutes ago must be entered as late with a reason");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Drill log is already final" } });
    response = await COMMAND(post("https://local.test/d", finalize), params(drillId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Drill log is already final", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Drill log is a draft; corrections apply to final logs" } });
    response = await COMMAND(post("https://local.test/d", { request_key: key, action: "correct", expected_version: 1, payload: { reason: "x", notes: "y" } }), params(drillId));
    expect(response.status).toBe(409);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Record changed since it was read", details: "current_record_version=3" } });
    response = await COMMAND(post("https://local.test/d", { request_key: key, action: "correct", expected_version: 2, payload: { reason: "x", notes: "y" } }), params(drillId));
    expect(response.status).toBe(409);
    expect((await response.json()).current_record_version).toBe("3");
    rpc.mockResolvedValueOnce({ data: { record: { id: drillId } }, error: null });
    response = await COMMAND(post("https://local.test/d", finalize), params(drillId));
    expect(response.status).toBe(500);
    expect((await response.json()).outcome).toBe("uncertain");
  });
});
