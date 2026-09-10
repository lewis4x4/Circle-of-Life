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
let readCap = 1000;
let failPageAt: number | null = null;
const readRanges: number[] = [];
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
const selects: string[] = [];
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "is", "not"]) query[method] = vi.fn(() => query);
  query.select = vi.fn((columns: string) => { selects.push(columns); return query; });
  isCalls.push(query.is as ReturnType<typeof vi.fn>);
  // The history uses recorded_at/id order and range reads until empty.
  query.order = vi.fn((column: string, options: unknown) => { order(column, options); return query; });
  query.range = async (start: number, end: number) => {
    readRanges.push(start);
    if (start === failPageAt) return { data: null, error: { message: "later page unavailable" } };
    return Array.isArray(listResult.data) ? { ...listResult, data: listResult.data.slice(start, Math.min(end + 1, start + readCap)) } : listResult;
  };
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const receiptId = "77777777-7777-4777-8777-777777777777";
const occurrenceState = { id: occurrenceId, status: "pending", execution_state: "none", occurrence_revision: "a".repeat(64), effective_receipt_id: null, performed_at: null };
const key = "record:2026-09-10:0001";
const post = (body: unknown) => new Request("https://local.test/record", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const receiptOutcome = { receipt: { id: receiptId, completion_state: "completed", request_hash: "f".repeat(64) }, occurrence: { id: occurrenceId, status: "completed", execution_state: "completed", occurrence_revision: "c".repeat(64) }, issue: null, replayed: false };

beforeEach(() => {
  vi.clearAllMocks();
  selects.length = 0;
  readCap = 1000;
  failPageAt = null;
  readRanges.length = 0;
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { ...occurrenceState, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" }, error: null });
  listResult = { data: [], error: null };
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
  const reviewedRevision = "a".repeat(64);
  const currentRevision = "b".repeat(64);
  const currentReceiptId = "99999999-9999-4999-8999-999999999999";
  const bound = { decision: "verified", receipt_id: receiptId, receipt_revision: reviewedRevision };

  it("forwards the decision bound to the reviewed receipt and returns the verification receipt", async () => {
    rpc.mockResolvedValue({ data: { ...receiptOutcome, receipt: { id: receiptId, receipt_kind: "verification", verifies_receipt_id: receiptId, verified_receipt_revision: reviewedRevision } }, error: null });
    const response = await VERIFY(post({ request_key: key, payload: { ...bound, note: "Checked the panel photo" } }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("verify_operation_work_review", { p_task: occurrenceId, p_request_key: key, p_payload: { ...bound, note: "Checked the panel photo" } });
    const body = await response.json();
    expect(body.receipt.receipt_kind).toBe("verification");
    expect(body.receipt.verifies_receipt_id).toBe(receiptId);
  });

  it("requires the reviewed receipt and its revision before any read (COL-145 binding)", async () => {
    for (const payload of [{ decision: "verified" }, { decision: "verified", receipt_id: receiptId }, { decision: "verified", receipt_revision: reviewedRevision }, { decision: "verified", receipt_id: receiptId, receipt_revision: "stale" }]) {
      const response = await VERIFY(post({ request_key: key, payload }), params(occurrenceId));
      expect(response.status).toBe(400);
      expect((await response.json()).outcome).toBe("validation");
    }
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a review of a superseded receipt as a conflict naming the current receipt and its revision", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Receipt changed since it was read", details: `current_receipt_id=${currentReceiptId};current_receipt_revision=${currentRevision}` } });
    const stale = await VERIFY(post({ request_key: key, payload: bound }), params(occurrenceId));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "Receipt changed since it was read", outcome: "conflict", current_receipt_id: currentReceiptId, current_receipt_revision: currentRevision });
  });

  it("refuses a decision other than verified and surfaces independence and evidence conflicts", async () => {
    expect((await VERIFY(post({ request_key: key, payload: { ...bound, decision: "rejected" } }), params(occurrenceId))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "A different authorized staff member must verify this task" } });
    const independence = await VERIFY(post({ request_key: key, payload: bound }), params(occurrenceId));
    expect(independence.status).toBe(409);
    expect(await independence.json()).toEqual({ error: "A different authorized staff member must verify this task", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Required evidence is missing" } });
    expect(await (await VERIFY(post({ request_key: key, payload: bound }), params(occurrenceId))).json()).toMatchObject({ outcome: "conflict", error: "Required evidence is missing" });
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

  it("returns the whole chain under a small provider cap and refuses a partial chain after a later failure", async () => {
    readCap = 17;
    const receipts = Array.from({ length: 1101 }, (_, i) => ({ id: `receipt-${i}`, receipt_kind: i % 2 ? "correction" : "performance" }));
    listResult = { data: receipts, error: null };
    const request = new NextRequest("https://local.test/receipts");
    const response = await RECEIPTS(request, params(occurrenceId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receipts, occurrence: occurrenceState });
    expect(readRanges.slice(0, 3)).toEqual([0, 17, 34]);
    failPageAt = 17;
    const failed = await RECEIPTS(request, params(occurrenceId));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Receipts unavailable" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns only safe current occurrence facts instead of inferring state from an immutable receipt", async () => {
    const current = { id: occurrenceId, status: "completed", execution_state: "completed", occurrence_revision: "f".repeat(64), effective_receipt_id: receiptId, performed_at: "2026-09-10T15:00:00Z" };
    maybeSingle.mockResolvedValue({ data: { ...current, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled", subject_id: "private-subject", object_path: "private-object", completion_notes: "private-notes" }, error: null });
    const receipts = [{ id: receiptId, completion_state: "performed_missing_evidence", evidence_status_current: "complete" }];
    listResult = { data: receipts, error: null };
    const response = await RECEIPTS(new NextRequest("https://local.test/receipts"), params(occurrenceId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ receipts, occurrence: current });
    expect(Object.keys(body.occurrence).sort()).toEqual(["effective_receipt_id", "execution_state", "id", "occurrence_revision", "performed_at", "status"]);
    expect(JSON.stringify(body)).not.toContain("private-");
    expect(selects[0]).toBe("id, facility_id, organization_id, occurrence_kind, status, execution_state, occurrence_revision, effective_receipt_id, performed_at");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("retries when a lost-answer command commits between target and receipt reads", async () => {
    const before = { ...occurrenceState, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" };
    const after = { ...before, status: "completed", execution_state: "completed", occurrence_revision: "b".repeat(64), effective_receipt_id: receiptId, performed_at: "2026-09-10T15:00:00Z" };
    maybeSingle.mockResolvedValueOnce({ data: before, error: null }).mockResolvedValue({ data: after, error: null });
    const receipts = [{ id: receiptId, completion_state: "completed" }];
    listResult = { data: receipts, error: null };
    const response = await RECEIPTS(new NextRequest("https://local.test/receipts"), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receipts, occurrence: { id: after.id, status: after.status, execution_state: after.execution_state, occurrence_revision: after.occurrence_revision, effective_receipt_id: after.effective_receipt_id, performed_at: after.performed_at } });
    expect(maybeSingle).toHaveBeenCalledTimes(4);
    expect(actorCanAccessFacility).toHaveBeenCalledTimes(4);
    expect(readRanges).toEqual([0, 1, 0, 1]);
  });

  it("returns retryable 503 after a second lifecycle change rather than a mixed snapshot", async () => {
    for (const revision of ["a", "b", "c", "d"]) maybeSingle.mockResolvedValueOnce({ data: { ...occurrenceState, occurrence_revision: revision.repeat(64), facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" }, error: null });
    listResult = { data: [{ id: receiptId }], error: null };
    const response = await RECEIPTS(new NextRequest("https://local.test/receipts"), params(occurrenceId));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Occurrence changed while reading receipts; retry", outcome: "uncertain" });
    expect(maybeSingle).toHaveBeenCalledTimes(4);
  });

  it("fails closed if the occurrence or site authority disappears during the chain read", async () => {
    const before = { ...occurrenceState, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" };
    maybeSingle.mockResolvedValueOnce({ data: before, error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect((await RECEIPTS(new NextRequest("https://local.test/receipts"), params(occurrenceId))).status).toBe(404);
    maybeSingle.mockResolvedValue({ data: before, error: null });
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await RECEIPTS(new NextRequest("https://local.test/receipts"), params(occurrenceId))).status).toBe(404);
  });

  it("lists the whole receipt history of a granted occurrence in recorded order through the session client", async () => {
    const correctionId = "88888888-8888-4888-8888-888888888888";
    const history = [
      { id: receiptId, receipt_kind: "performance", chain_id: receiptId, corrects_receipt_id: null, correction_seq: 0, superseded_by_receipt_id: correctionId, superseded_at: "2026-09-10T15:00:00Z" },
      { id: correctionId, receipt_kind: "performance", chain_id: receiptId, corrects_receipt_id: receiptId, correction_reason: "Wrong reading", correction_seq: 1, superseded_by_receipt_id: null },
      { id: "99999999-9999-4999-8999-999999999999", receipt_kind: "verification", verifies_receipt_id: correctionId, verified_receipt_revision: "b".repeat(64) },
    ];
    listResult = { data: history, error: null };
    const response = await RECEIPTS(new NextRequest("https://local.test/receipts") as never, params(occurrenceId));
    expect(response.status).toBe(200);
    // Every receipt of every chain is returned verbatim: recordings, corrections, reversals and reviews.
    expect(await response.json()).toEqual({ receipts: history, occurrence: occurrenceState });
    expect(from).toHaveBeenCalledWith("operation_execution_receipts");
    expect(from).toHaveBeenLastCalledWith("operation_task_instances");
    // Recorded order, with the id as a deterministic tiebreak for receipts written in the same instant.
    expect(order.mock.calls.slice(0, 2)).toEqual([["recorded_at", { ascending: true }], ["id", { ascending: true }]]);
    const receiptSelect = (selects.find((columns) => columns.includes("evidence_status_current")) ?? "").split(", ");
    // COL-143: the current evidence status and satisfaction instant ride beside the immutable receipt columns.
    expect(receiptSelect).toContain("evidence_status_current");
    expect(receiptSelect).toContain("evidence_satisfied_at");
    // COL-145: the chain, supersession and review-binding columns make the history readable.
    for (const column of ["chain_id", "corrects_receipt_id", "correction_reason", "correction_seq", "superseded_by_receipt_id", "superseded_at", "verifies_receipt_id", "verified_receipt_revision", "revision"]) {
      expect(receiptSelect).toContain(column);
    }
    expect(receiptSelect).not.toContain("request_hash");
  });
});
