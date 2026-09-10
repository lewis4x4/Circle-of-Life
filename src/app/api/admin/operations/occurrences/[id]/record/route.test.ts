import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST as RECORD } from "./route";
import { POST as VERIFY } from "../verify/route";
import { GET as RECEIPTS } from "../receipts/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const isCalls: Array<ReturnType<typeof vi.fn>> = [];
const maybeSingle = vi.fn();
const order = vi.fn();
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not"]) query[method] = vi.fn(() => query);
  isCalls.push(query.is as ReturnType<typeof vi.fn>);
  query.order = order;
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const receiptId = "77777777-7777-4777-8777-777777777777";
const key = "record:2026-09-10:0001";
const post = (body: unknown) => new Request("https://local.test/record", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const receiptOutcome = { receipt: { id: receiptId, completion_state: "completed", request_hash: "f".repeat(64) }, occurrence: { id: occurrenceId, status: "completed", execution_state: "completed", occurrence_revision: "c".repeat(64) }, issue: null, replayed: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" }, error: null });
  order.mockResolvedValue({ data: [], error: null });
});

describe("record work", () => {
  it("refuses a malformed payload with the validation class before any read", async () => {
    const response = await RECORD(post({ request_key: key, payload: { outcome: "failed" } }), params(occurrenceId));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "a failed outcome requires an issue", outcome: "validation" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a legacy row, a foreign row and an ungranted site as missing before the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: null }, error: null });
    expect((await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Occurrence not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops before the command when the actor no longer revalidates", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    expect((await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards exactly the request key and payload and returns the receipt outcome", async () => {
    rpc.mockResolvedValue({ data: receiptOutcome, error: null });
    isCalls.length = 0;
    const payload = { outcome: "performed", values: { run_minutes: 12 }, note: "Ran clean" };
    const response = await RECORD(post({ request_key: key, payload }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_operation_work_review", { p_task: occurrenceId, p_request_key: key, p_payload: payload });
    // A removed row is missing, never a denial: the session read excludes soft-deleted occurrences.
    expect(isCalls[0]).toHaveBeenCalledWith("deleted_at", null);
    // The request fingerprint is server-side idempotency material and is never returned.
    expect(await response.json()).toEqual({ outcome: "receipt", receipt: { id: receiptId, completion_state: "completed" }, occurrence: receiptOutcome.occurrence, issue: null, replayed: false });
  });

  it("reports a session read failure as uncertain and an organization mismatch as missing", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    const failed = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Occurrence unavailable", outcome: "uncertain" });
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "other-org", occurrence_kind: "scheduled" }, error: null });
    expect((await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the late-entry boundary wording through as validation and a bare duplicate as a generic conflict", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Work performed more than fifteen minutes before recording must be entered as late" } });
    const late = await RECORD(post({ request_key: key, payload: { outcome: "performed", performed_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() } }), params(occurrenceId));
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual({ error: "Work performed more than fifteen minutes before recording must be entered as late", outcome: "validation" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint operation_execution_receipts_effective" } });
    const bare = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(bare.status).toBe(409);
    expect(await bare.json()).toEqual({ error: "Record request conflicts with an existing receipt", outcome: "conflict" });
  });

  it("reports an existing receipt as a conflict naming it, and a replay as the same receipt", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "Work is already recorded for this occurrence", details: `current_receipt_id=${receiptId}` } });
    const conflict = await RECORD(post({ request_key: "record:other:0002", payload: { outcome: "performed" } }), params(occurrenceId));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Work is already recorded for this occurrence", outcome: "conflict", current_receipt_id: receiptId });
    rpc.mockResolvedValueOnce({ data: { ...receiptOutcome, replayed: true }, error: null });
    const replay = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect((await replay.json()).replayed).toBe(true);
  });

  it("classifies a database validation refusal and hides existence on denial", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Recorded values are invalid: run_minutes is required" } });
    const validation = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(validation.status).toBe(400);
    expect(await validation.json()).toEqual({ error: "Recorded values are invalid: run_minutes is required", outcome: "validation" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    const denied = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
  });

  it("returns the uncertain class without echoing internal detail and logs it", async () => {
    const sentinel = "relation public.operation_execution_receipts deadlock detected";
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01", message: sentinel } });
    const response = await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Record could not be confirmed; check the occurrence before retrying", outcome: "uncertain" });
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith("admin.operations.occurrences.record", expect.objectContaining({ message: sentinel }), { action: "rpc", occurrenceId });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect((await RECORD(post({ request_key: key, payload: { outcome: "performed" } }), params(occurrenceId))).status).toBe(500);
  });
});

describe("verify work", () => {
  it("forwards the decision and returns the verification receipt", async () => {
    rpc.mockResolvedValue({ data: { ...receiptOutcome, receipt: { id: receiptId, receipt_kind: "verification" } }, error: null });
    const response = await VERIFY(post({ request_key: key, payload: { decision: "verified" } }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("verify_operation_work_review", { p_task: occurrenceId, p_request_key: key, p_payload: { decision: "verified" } });
    expect((await response.json()).receipt.receipt_kind).toBe("verification");
  });

  it("refuses a decision other than verified and surfaces independence and evidence conflicts", async () => {
    expect((await VERIFY(post({ request_key: key, payload: { decision: "rejected" } }), params(occurrenceId))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "A different authorized staff member must verify this task" } });
    const independence = await VERIFY(post({ request_key: key, payload: { decision: "verified" } }), params(occurrenceId));
    expect(independence.status).toBe(409);
    expect(await independence.json()).toEqual({ error: "A different authorized staff member must verify this task", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Required evidence is missing" } });
    expect(await (await VERIFY(post({ request_key: key, payload: { decision: "verified" } }), params(occurrenceId))).json()).toMatchObject({ outcome: "conflict", error: "Required evidence is missing" });
  });
});

describe("receipts read", () => {
  it("hides an ungranted or legacy occurrence before reading receipts", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await RECEIPTS(new NextRequest("https://local.test/receipts") as never, params(occurrenceId))).status).toBe(404);
    expect(from).toHaveBeenCalledTimes(1);
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: null }, error: null });
    expect((await RECEIPTS(new NextRequest("https://local.test/receipts") as never, params(occurrenceId))).status).toBe(404);
  });

  it("lists receipts of a granted occurrence through the session client", async () => {
    order.mockResolvedValue({ data: [{ id: receiptId, receipt_kind: "performance" }], error: null });
    const response = await RECEIPTS(new NextRequest("https://local.test/receipts") as never, params(occurrenceId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receipts: [{ id: receiptId, receipt_kind: "performance" }] });
    expect(from).toHaveBeenLastCalledWith("operation_execution_receipts");
  });
});
