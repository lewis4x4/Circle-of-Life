import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST as CORRECT } from "./route";
import { POST as REVERSE } from "../reverse/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const isCalls: Array<ReturnType<typeof vi.fn>> = [];
const maybeSingle = vi.fn();
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "is", "not", "select"]) query[method] = vi.fn(() => query);
  isCalls.push(query.is as ReturnType<typeof vi.fn>);
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const originalId = "66666666-6666-4666-8666-666666666666";
const receiptId = "77777777-7777-4777-8777-777777777777";
const reviewId = "88888888-8888-4888-8888-888888888888";
const issueId = "99999999-9999-4999-8999-999999999999";
const originalRevision = "a".repeat(64);
const currentRevision = "b".repeat(64);
const key = "correct:2026-09-10:0001";
const expected = { expected_receipt_id: originalId, expected_receipt_revision: originalRevision };
const correction = { outcome: "performed", values: { run_minutes: 14 }, note: "Corrected the run time", reason: "Typed 12 instead of 14" };
const reversal = { reason: "Recorded on the wrong occurrence" };
const post = (body: unknown) => new Request("https://local.test/command", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const staleDetails = `current_receipt_id=${receiptId};current_receipt_revision=${currentRevision}`;
const correctionOutcome = {
  receipt: { id: receiptId, receipt_kind: "performance", chain_id: originalId, corrects_receipt_id: originalId, correction_seq: 1, completion_state: "awaiting_verification", request_hash: "f".repeat(64) },
  corrected: { id: originalId, receipt_kind: "performance", chain_id: originalId, superseded_by_receipt_id: receiptId, superseded_at: "2026-09-10T15:00:00Z", request_hash: "e".repeat(64) },
  occurrence: { id: occurrenceId, status: "in_progress", execution_state: "awaiting_verification", effective_receipt_id: receiptId, occurrence_revision: "c".repeat(64) },
  issue: null,
  verification_superseded_receipt_id: reviewId,
  replayed: false,
};
const reversalOutcome = {
  receipt: { id: receiptId, receipt_kind: "reversal", chain_id: originalId, corrects_receipt_id: originalId, completion_state: "reversed", request_hash: "f".repeat(64) },
  reversed: { id: originalId, receipt_kind: "performance", superseded_by_receipt_id: receiptId, request_hash: "e".repeat(64) },
  occurrence: { id: occurrenceId, status: "pending", execution_state: "none", effective_receipt_id: null, occurrence_revision: "d".repeat(64) },
  issue: null,
  verification_superseded_receipt_id: reviewId,
  replayed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  isCalls.length = 0;
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: "scheduled" }, error: null });
});

describe("correct work", () => {
  it("refuses a correction without the corrected receipt, its revision or a reason before any read", async () => {
    const unnamed = await CORRECT(post({ request_key: key, payload: correction }), params(occurrenceId));
    expect(unnamed.status).toBe(400);
    expect((await unnamed.json()).outcome).toBe("validation");
    const stale = await CORRECT(post({ request_key: key, expected_receipt_id: originalId, expected_receipt_revision: "notahash", payload: correction }), params(occurrenceId));
    expect(stale.status).toBe(400);
    expect((await stale.json()).error).toMatch(/^expected_receipt_revision: /);
    const unreasoned = await CORRECT(post({ request_key: key, ...expected, payload: { outcome: "performed" } }), params(occurrenceId));
    expect(unreasoned.status).toBe(400);
    expect((await unreasoned.json()).error).toMatch(/^payload\.reason: /);
    const failed = await CORRECT(post({ request_key: key, ...expected, payload: { outcome: "failed", reason: "It failed" } }), params(occurrenceId));
    expect(await failed.json()).toEqual({ error: "a failed outcome requires an issue", outcome: "validation" });
    expect((await CORRECT(new Request("https://local.test/command", { method: "POST", body: "{" }) as never, params(occurrenceId))).status).toBe(400);
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params("not-a-uuid"))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a legacy row, a foreign row, another organization and an ungranted site as missing before the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: null }, error: null });
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "other-org", occurrence_kind: "scheduled" }, error: null });
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Occurrence not found", outcome: "missing" });
    expect(actorCanAccessFacility).toHaveBeenLastCalledWith(actor, facilityId);
    // A removed row is missing, never a denial: the session read excludes soft-deleted occurrences.
    expect(isCalls[0]).toHaveBeenCalledWith("deleted_at", null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a session read failure as uncertain and stops before the command when the actor no longer revalidates", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    const failed = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Occurrence unavailable", outcome: "uncertain" });
    expect(logError).toHaveBeenCalledWith("admin.operations.occurrences.correct", expect.objectContaining({ message: "connection reset" }), { action: "read", occurrenceId });
    vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the request key, the expected receipt identity and the payload, and returns the correction with the superseded receipt and review", async () => {
    rpc.mockResolvedValueOnce({ data: correctionOutcome, error: null });
    const response = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("correct_operation_work_review", {
      p_task: occurrenceId,
      p_request_key: key,
      p_expected_receipt_id: originalId,
      p_expected_receipt_revision: originalRevision,
      p_payload: correction,
    });
    const body = await response.json();
    // Request fingerprints are server-side idempotency material and never leave the server, on either receipt.
    expect(body).toEqual({
      outcome: "receipt",
      receipt: { id: receiptId, receipt_kind: "performance", chain_id: originalId, corrects_receipt_id: originalId, correction_seq: 1, completion_state: "awaiting_verification" },
      corrected: { id: originalId, receipt_kind: "performance", chain_id: originalId, superseded_by_receipt_id: receiptId, superseded_at: "2026-09-10T15:00:00Z" },
      occurrence: correctionOutcome.occurrence,
      issue: null,
      verification_superseded_receipt_id: reviewId,
      replayed: false,
    });
    expect(JSON.stringify(body)).not.toContain("request_hash");
  });

  it("returns the issue a failed correction created, a null superseded review when none existed, and a replay as the same receipt", async () => {
    const withIssue = { ...correctionOutcome, issue: { id: issueId, issue_kind: "failed_result", request_hash: "d".repeat(64) }, verification_superseded_receipt_id: null, replayed: true };
    rpc.mockResolvedValueOnce({ data: withIssue, error: null });
    const payload = { outcome: "failed", reason: "Result was a failure", issue: { kind: "failed_result", summary: "Generator stalled" } };
    const body = await (await CORRECT(post({ request_key: key, ...expected, payload }), params(occurrenceId))).json();
    expect(body.issue).toEqual({ id: issueId, issue_kind: "failed_result" });
    expect(body.verification_superseded_receipt_id).toBeNull();
    expect(body.replayed).toBe(true);
    rpc.mockResolvedValueOnce({ data: { ...correctionOutcome, verification_superseded_receipt_id: undefined }, error: null });
    expect((await (await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).json()).verification_superseded_receipt_id).toBeNull();
  });

  it("reports a stale or superseded receipt as a conflict naming the current receipt and its revision", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Receipt changed since it was read", details: staleDetails } });
    const conflict = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Receipt changed since it was read", outcome: "conflict", current_receipt_id: receiptId, current_receipt_revision: currentRevision });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    const changed = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "This request was already saved with different content", outcome: "conflict" });
  });

  it("passes the correction time rules through as validation and hides existence on denial", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Corrected performed time cannot be after the original recording" } });
    const late = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual({ error: "Corrected performed time cannot be after the original recording", outcome: "validation" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Work performed more than fifteen minutes before recording must be entered as late" } });
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Task actor is no longer authorized" } });
    const denied = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "query returned no rows" } });
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(404);
  });

  it("returns the uncertain class without echoing internal detail, logs it, and refuses an unconfirmed reply", async () => {
    const sentinel = "relation public.operation_execution_receipts deadlock detected";
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01", message: sentinel } });
    const response = await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Correction could not be confirmed; check the occurrence before retrying", outcome: "uncertain" });
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith("admin.operations.occurrences.correct", expect.objectContaining({ message: sentinel }), { action: "rpc", occurrenceId });
    // A reply without the superseded receipt is not a confirmed correction.
    rpc.mockResolvedValueOnce({ data: { receipt: { id: receiptId }, occurrence: { id: occurrenceId }, issue: null, replayed: false }, error: null });
    expect((await CORRECT(post({ request_key: key, ...expected, payload: correction }), params(occurrenceId))).status).toBe(500);
  });
});

describe("reverse work", () => {
  it("refuses a reversal without the reversed receipt, its revision or a reason before any read", async () => {
    expect((await REVERSE(post({ request_key: key, payload: reversal }), params(occurrenceId))).status).toBe(400);
    expect((await REVERSE(post({ request_key: key, ...expected, payload: {} }), params(occurrenceId))).status).toBe(400);
    const extra = await REVERSE(post({ request_key: key, ...expected, payload: { ...reversal, outcome: "performed" } }), params(occurrenceId));
    expect(extra.status).toBe(400);
    expect((await extra.json()).outcome).toBe("validation");
    expect((await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params("not-a-uuid"))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a legacy row, a foreign row and an ungranted site as missing before the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org", occurrence_kind: null }, error: null });
    expect((await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Occurrence not found", outcome: "missing" });
    expect(isCalls[0]).toHaveBeenCalledWith("deleted_at", null);
    vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    expect((await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the expected receipt identity and the reason, and returns the reversal with the reversed receipt, the superseded review and the unrecorded occurrence", async () => {
    rpc.mockResolvedValueOnce({ data: reversalOutcome, error: null });
    const response = await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reverse_operation_work_review", {
      p_task: occurrenceId,
      p_request_key: key,
      p_expected_receipt_id: originalId,
      p_expected_receipt_revision: originalRevision,
      p_payload: reversal,
    });
    const body = await response.json();
    // The reply names the superseded receipt as `reversed`; a reversal never creates an issue, so none is echoed.
    expect(body).toEqual({
      outcome: "receipt",
      receipt: { id: receiptId, receipt_kind: "reversal", chain_id: originalId, corrects_receipt_id: originalId, completion_state: "reversed" },
      reversed: { id: originalId, receipt_kind: "performance", superseded_by_receipt_id: receiptId },
      occurrence: reversalOutcome.occurrence,
      verification_superseded_receipt_id: reviewId,
      replayed: false,
    });
    expect(JSON.stringify(body)).not.toContain("request_hash");
    rpc.mockResolvedValueOnce({ data: { ...reversalOutcome, verification_superseded_receipt_id: null, replayed: true }, error: null });
    const replay = await (await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).json();
    expect(replay.replayed).toBe(true);
    expect(replay.verification_superseded_receipt_id).toBeNull();
    rpc.mockResolvedValueOnce({ data: { ...reversalOutcome, verification_superseded_receipt_id: undefined }, error: null });
    expect((await (await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).json()).verification_superseded_receipt_id).toBeNull();
  });

  it("reports a stale receipt as a conflict naming the current receipt, and an unrecorded occurrence as a conflict", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Receipt changed since it was read", details: staleDetails } });
    const conflict = await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Receipt changed since it was read", outcome: "conflict", current_receipt_id: receiptId, current_receipt_revision: currentRevision });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Occurrence has no recorded work" } });
    const unrecorded = await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId));
    expect(unrecorded.status).toBe(409);
    expect(await unrecorded.json()).toEqual({ error: "Occurrence has no recorded work", outcome: "conflict" });
  });

  it("hides existence on denial and returns the uncertain class without echoing internal detail", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Task actor is no longer authorized" } });
    const denied = await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
    const sentinel = "relation public.operation_execution_receipts deadlock detected";
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01", message: sentinel } });
    const response = await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Reversal could not be confirmed; check the occurrence before retrying", outcome: "uncertain" });
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith("admin.operations.occurrences.reverse", expect.objectContaining({ message: sentinel }), { action: "rpc", occurrenceId });
    // A reply without the reversed receipt, or one shaped like a correction, is not a confirmed reversal.
    rpc.mockResolvedValueOnce({ data: { receipt: { id: receiptId }, occurrence: { id: occurrenceId }, replayed: false }, error: null });
    expect((await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).status).toBe(500);
    rpc.mockResolvedValueOnce({ data: correctionOutcome, error: null });
    expect((await REVERSE(post({ request_key: key, ...expected, payload: reversal }), params(occurrenceId))).status).toBe(500);
  });
});
