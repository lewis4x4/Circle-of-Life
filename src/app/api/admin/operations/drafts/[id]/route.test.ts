import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET as RECONCILE } from "./route";
import { POST as RESUME } from "./resume/route";
import { POST as DISCARD } from "./discard/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) query[method] = vi.fn(() => query);
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const receiptId = "77777777-7777-4777-8777-777777777777";
const issueId = "88888888-8888-4888-8888-888888888888";
const draftId = "99999999-9999-4999-8999-999999999999";
const key = "record:2026-09-10:0001";
const request = (method: string) => new NextRequest(`https://local.test/drafts/${draftId}`, { method });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const target = { id: draftId, organization_id: "org", facility_id: facilityId, actor_id: "actor", state: "pending", target_id: occurrenceId, command: "record_work" };
const draftRow = { id: draftId, actor_id: "actor", command: "record_work", target_id: occurrenceId, request_key: key, state: "pending", expires_at: new Date(Date.now() + 3_600_000).toISOString(), arguments: { payload: { outcome: "performed" } }, arguments_hash: "h".repeat(64) };
const { arguments_hash: _hash, ...visibleDraft } = draftRow;
void _hash;
const receiptReply = { receipt: { id: receiptId, completion_state: "completed", request_hash: "f".repeat(64) }, occurrence: { id: occurrenceId, status: "completed" }, issue: null, replayed: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: target, error: null });
});

describe("draft ownership", () => {
  it.each([
    ["reconcile", () => RECONCILE(request("GET"), params(draftId))],
    ["resume", () => RESUME(request("POST"), params(draftId))],
    ["discard", () => DISCARD(request("POST"), params(draftId))],
  ])("%s treats another actor's draft, a foreign organisation and an ungranted site as absent before the command", async (_name, call) => {
    maybeSingle.mockResolvedValueOnce({ data: { ...target, actor_id: "someone-else" }, error: null });
    const other = await call();
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "Draft not found", outcome: "missing" });
    maybeSingle.mockResolvedValueOnce({ data: { ...target, organization_id: "other" }, error: null });
    expect((await call()).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await call()).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await call()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("operation_command_drafts");
  });

  it("refuses a malformed id before any read and stops when the actor no longer revalidates", async () => {
    expect((await RECONCILE(request("GET"), params("not-a-uuid"))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    expect((await RESUME(request("POST"), params(draftId))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("reconcile", () => {
  it("answers saved with the record, unsaved, expired or discarded from the database", async () => {
    rpc.mockResolvedValueOnce({ data: { draft: { ...draftRow, state: "reconciled" }, outcome: "saved", record: { kind: "receipt", id: receiptId, replayed: false, request_hash: "x" } }, error: null });
    const saved = await RECONCILE(request("GET"), params(draftId));
    expect(saved.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reconcile_operation_command_draft_review", { p_draft: draftId });
    expect(await saved.json()).toEqual({ outcome: "saved", draft: { ...visibleDraft, state: "reconciled" }, record: { kind: "receipt", id: receiptId, replayed: false } });
    rpc.mockResolvedValueOnce({ data: { draft: draftRow, outcome: "unsaved" }, error: null });
    expect(await (await RECONCILE(request("GET"), params(draftId))).json()).toEqual({ outcome: "unsaved", draft: visibleDraft });
    rpc.mockResolvedValueOnce({ data: { draft: { ...draftRow, state: "expired" }, outcome: "expired" }, error: null });
    expect((await (await RECONCILE(request("GET"), params(draftId))).json()).outcome).toBe("expired");
    rpc.mockResolvedValueOnce({ data: { draft: { ...draftRow, state: "discarded" }, outcome: "discarded" }, error: null });
    expect((await (await RECONCILE(request("GET"), params(draftId))).json()).outcome).toBe("discarded");
  });

  it("never reports saved without a record and hides internal wording on failure", async () => {
    rpc.mockResolvedValueOnce({ data: { draft: draftRow, outcome: "saved" }, error: null });
    const shapeless = await RECONCILE(request("GET"), params(draftId));
    expect(shapeless.status).toBe(500);
    expect((await shapeless.json()).outcome).toBe("uncertain");
    const sentinel = "deadlock detected on operation_command_drafts";
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01", message: sentinel } });
    const failed = await RECONCILE(request("GET"), params(draftId));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith("admin.operations.drafts.reconcile", expect.objectContaining({ message: sentinel }), { action: "rpc", draftId });
  });
});

describe("resume", () => {
  it("executes the stored record command and returns the receipt reply as the record route would", async () => {
    rpc.mockResolvedValueOnce({ data: { draft: { ...draftRow, state: "reconciled" }, outcome: "saved", reply: { ...receiptReply, replayed: true } }, error: null });
    const response = await RESUME(request("POST"), params(draftId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("resume_operation_command_draft_review", { p_draft: draftId });
    expect(await response.json()).toEqual({
      outcome: "saved",
      draft: { ...visibleDraft, state: "reconciled" },
      reply: { outcome: "receipt", receipt: { id: receiptId, completion_state: "completed" }, occurrence: receiptReply.occurrence, issue: null, replayed: true },
    });
  });

  it("dispatches an issue report draft to the issue reply shape and refuses a reply of the wrong shape", async () => {
    maybeSingle.mockResolvedValue({ data: { ...target, command: "report_issue", target_id: null }, error: null });
    rpc.mockResolvedValueOnce({ data: { draft: { ...draftRow, command: "report_issue", state: "reconciled" }, outcome: "saved", reply: { issue: { id: issueId, status: "open", request_hash: "x" }, replayed: false } }, error: null });
    const response = await RESUME(request("POST"), params(draftId));
    expect(await response.json()).toMatchObject({ outcome: "saved", reply: { outcome: "receipt", issue: { id: issueId, status: "open" }, replayed: false } });
    rpc.mockResolvedValueOnce({ data: { draft: draftRow, outcome: "saved", reply: receiptReply }, error: null });
    const wrong = await RESUME(request("POST"), params(draftId));
    expect(wrong.status).toBe(500);
    expect((await wrong.json()).outcome).toBe("uncertain");
    maybeSingle.mockResolvedValueOnce({ data: { ...target, command: "delete_work" }, error: null });
    expect((await RESUME(request("POST"), params(draftId))).status).toBe(500);
  });

  it("maps the command's own refusal exactly as the original route would, and draft refusals as their outcomes", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "Work is already recorded for this occurrence", details: `current_receipt_id=${receiptId}` } });
    const conflict = await RESUME(request("POST"), params(draftId));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Work is already recorded for this occurrence", outcome: "conflict", current_receipt_id: receiptId });
    maybeSingle.mockResolvedValueOnce({ data: { ...target, command: "correct_work" }, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Receipt changed since it was read", details: `current_receipt_id=${receiptId} current_receipt_revision=${"b".repeat(64)}` } });
    // COL-145: the stale-correction conflict names the current receipt and its revision so the client can re-read and retry against it.
    expect(await (await RESUME(request("POST"), params(draftId))).json()).toEqual({ error: "Receipt changed since it was read", outcome: "conflict", current_receipt_id: receiptId, current_receipt_revision: "b".repeat(64) });
    maybeSingle.mockResolvedValueOnce({ data: { ...target, command: "reverse_work" }, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    expect(await (await RESUME(request("POST"), params(draftId))).json()).toEqual({ error: "Reversal request conflicts with an existing receipt", outcome: "conflict" });
    maybeSingle.mockResolvedValueOnce({ data: { ...target, command: "verify_work" }, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "A different authorized staff member must verify this task" } });
    expect(await (await RESUME(request("POST"), params(draftId))).json()).toEqual({ error: "A different authorized staff member must verify this task", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Draft has expired" } });
    const expired = await RESUME(request("POST"), params(draftId));
    expect(expired.status).toBe(409);
    expect(await expired.json()).toEqual({ error: "Draft has expired", outcome: "expired" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Draft was discarded" } });
    expect(await (await RESUME(request("POST"), params(draftId))).json()).toEqual({ error: "Draft was discarded", outcome: "discarded" });
    // Another session resumed first: a draft-level conflict that the client reconciles, never a receipt error.
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Draft is not pending" } });
    const notPending = await RESUME(request("POST"), params(draftId));
    expect(notPending.status).toBe(409);
    expect(await notPending.json()).toEqual({ error: "Draft is not pending", outcome: "conflict" });
  });
});

describe("discard", () => {
  it("marks the draft discarded and is idempotent on a discarded draft", async () => {
    rpc.mockResolvedValue({ data: { draft: { ...draftRow, state: "discarded", discarded_at: "2026-09-10T15:00:00Z" } }, error: null });
    const response = await DISCARD(request("POST"), params(draftId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("discard_operation_command_draft_review", { p_draft: draftId });
    expect(await response.json()).toEqual({ outcome: "discarded", draft: { ...visibleDraft, state: "discarded", discarded_at: "2026-09-10T15:00:00Z" } });
    expect((await DISCARD(request("POST"), params(draftId))).status).toBe(200);
  });

  it("reports a refusal to discard a reconciled draft as a conflict and a shapeless reply as uncertain", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Draft is not pending" } });
    const conflict = await DISCARD(request("POST"), params(draftId));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Draft is not pending", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect((await DISCARD(request("POST"), params(draftId))).status).toBe(500);
    // A reply whose draft is not actually discarded is not a discard.
    rpc.mockResolvedValueOnce({ data: { draft: { ...draftRow, state: "pending" } }, error: null });
    expect((await DISCARD(request("POST"), params(draftId))).status).toBe(500);
  });
});
