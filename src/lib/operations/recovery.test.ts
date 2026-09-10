import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({ actorCanAccessFacility: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { actorCanAccessFacility } from "@/lib/operations/auth";
import {
  DRAFT_ARGUMENTS_MAX_BYTES,
  DRAFT_LIST_SELECT,
  DRAFT_RPC,
  draftPayloadProblem,
  isDiscardOutcome,
  isReconcileOutcome,
  isResumeOutcome,
  isSaveDraftOutcome,
  mapDraftRpcError,
  mapResumeRpcError,
  presentDraft,
  presentResumedReply,
  readDraftTarget,
  resumeErrorFields,
  saveDraftBodySchema,
} from "./recovery";

const occurrenceId = "55555555-5555-4555-8555-555555555555";
const facilityId = "33333333-3333-4333-8333-333333333333";
const activityId = "11111111-1111-4111-8111-111111111111";
const subjectId = "44444444-4444-4444-8444-444444444444";
const receiptId = "77777777-7777-4777-8777-777777777777";
const draftId = "99999999-9999-4999-8999-999999999999";
const revision = "a".repeat(64);
const key = "record:2026-09-10:0001";
const parse = (body: unknown) => saveDraftBodySchema.safeParse(body);
const problem = (body: unknown) => {
  const result = parse(body);
  return result.success ? null : draftPayloadProblem(result.error);
};

describe("save draft body", () => {
  it("names the four draft RPCs and the select lists without the fingerprint", () => {
    expect(DRAFT_RPC).toEqual({
      save: "save_operation_command_draft_review",
      reconcile: "reconcile_operation_command_draft_review",
      resume: "resume_operation_command_draft_review",
      discard: "discard_operation_command_draft_review",
    });
    expect(DRAFT_LIST_SELECT).not.toContain("arguments");
    expect(DRAFT_LIST_SELECT).not.toContain("actor_session_id");
    expect(DRAFT_LIST_SELECT).toContain("expires_at");
  });

  it("validates record arguments with the record rules and requires the occurrence", () => {
    expect(parse({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed", values: { run_minutes: 12 } } } }).success).toBe(true);
    expect(problem({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "failed" } } })).toBe("a failed outcome requires an issue");
    expect(parse({ request_key: key, command: "record_work", arguments: { payload: { outcome: "performed" } } }).success).toBe(false);
    expect(parse({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed" }, extra: 1 } }).success).toBe(false);
    expect(parse({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed", recorder_id: activityId } } }).success).toBe(false);
  });

  it("requires the receipt and its revision on a verification (COL-145) and keeps the decision strict", () => {
    expect(parse({ request_key: key, command: "verify_work", target_id: occurrenceId, arguments: { payload: { decision: "verified", receipt_id: receiptId, receipt_revision: revision } } }).success).toBe(true);
    expect(parse({ request_key: key, command: "verify_work", target_id: occurrenceId, arguments: { payload: { decision: "verified" } } }).success).toBe(false);
    expect(parse({ request_key: key, command: "verify_work", target_id: occurrenceId, arguments: { payload: { decision: "rejected", receipt_id: receiptId, receipt_revision: revision } } }).success).toBe(false);
    expect(parse({ request_key: key, command: "verify_work", target_id: occurrenceId, arguments: { payload: { decision: "verified", receipt_id: receiptId, receipt_revision: "zz" } } }).success).toBe(false);
    expect(parse({ request_key: key, command: "verify_work", target_id: occurrenceId, arguments: { payload: { decision: "verified", receipt_id: receiptId, receipt_revision: revision, other: true } } }).success).toBe(false);
  });

  it("validates a correction as the expected receipt, its revision and the record payload with a reason", () => {
    const payload = { outcome: "performed", values: { run_minutes: 14 }, reason: "Wrong reading entered" };
    expect(parse({ request_key: key, command: "correct_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload } }).success).toBe(true);
    expect(parse({ request_key: key, command: "correct_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { outcome: "performed" } } }).success).toBe(false);
    expect(problem({ request_key: key, command: "correct_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { outcome: "failed", reason: "x" } } })).toBe("a failed outcome requires an issue");
    expect(parse({ request_key: key, command: "correct_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { ...payload, unknown: 1 } } }).success).toBe(false);
    expect(parse({ request_key: key, command: "correct_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, payload } }).success).toBe(false);
  });

  it("lets the correction reason carry a late or on-behalf entry (COL-145) while not_performed still needs its own entry_reason, and stores parsed output", () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const late = { request_key: key, command: "correct_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { outcome: "performed", entry_kind: "late", performed_at: past, reason: "  Entered after the shift  " } } };
    const parsed = parse(late);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.command === "correct_work") expect(parsed.data.arguments.payload.reason).toBe("Entered after the shift");
    expect(parse({ request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed", entry_kind: "late", performed_at: past } } }).success).toBe(false);
    expect(parse({ ...late, arguments: { ...late.arguments, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: activityId }, entry_kind: "on_behalf", reason: "Covered" } } }).success).toBe(true);
    expect(problem({ ...late, arguments: { ...late.arguments, payload: { outcome: "not_performed", reason: "Area closed" } } })).toBe("not_performed requires entry_reason");
    expect(problem({ ...late, arguments: { ...late.arguments, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: activityId }, reason: "Covered" } } })).toBe("recording for another performer requires entry_kind on_behalf or late");
  });

  it("keeps a reversal to the expected receipt, its revision and a reason", () => {
    expect(parse({ request_key: key, command: "reverse_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { reason: "Recorded on the wrong occurrence" } } }).success).toBe(true);
    expect(parse({ request_key: key, command: "reverse_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { reason: "" } } }).success).toBe(false);
    expect(parse({ request_key: key, command: "reverse_work", target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: revision, payload: { reason: "x", outcome: "performed" } } }).success).toBe(false);
  });

  it("validates an issue report with the issue schema and lets target and site only echo the payload", () => {
    const linked = { payload: { task_instance_id: occurrenceId, kind: "help_request", summary: "Need the generator key" } };
    const scoped = { payload: { activity_id: activityId, facility_id: facilityId, subject_id: subjectId, kind: "problem", summary: "Leak" } };
    expect(parse({ request_key: key, command: "report_issue", arguments: linked }).success).toBe(true);
    expect(parse({ request_key: key, command: "report_issue", target_id: occurrenceId, arguments: linked }).success).toBe(true);
    expect(problem({ request_key: key, command: "report_issue", target_id: activityId, arguments: linked })).toBe("target_id must name the occurrence of the issue report");
    expect(parse({ request_key: key, command: "report_issue", facility_id: facilityId, arguments: scoped }).success).toBe(true);
    expect(problem({ request_key: key, command: "report_issue", facility_id: subjectId, arguments: scoped })).toBe("facility_id must name the site of the issue report");
    expect(problem({ request_key: key, command: "report_issue", arguments: { payload: { activity_id: activityId, kind: "problem", summary: "Leak" } } })).toBe("name either the occurrence or the activity, site and subject");
  });

  it("refuses an unknown command, a short key and oversize arguments", () => {
    expect(parse({ request_key: key, command: "delete_work", target_id: occurrenceId, arguments: { payload: {} } }).success).toBe(false);
    expect(parse({ request_key: "short", command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed" } } }).success).toBe(false);
    const note = "n".repeat(4000);
    const values = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`reading_${index}`, "v".repeat(4000)]));
    const body = { request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed", note, values } } };
    expect(JSON.stringify(body.arguments).length).toBeGreaterThan(DRAFT_ARGUMENTS_MAX_BYTES);
    expect(problem(body)).toBe("arguments must be at most 64 KiB");
  });
});

describe("draft presentation", () => {
  const draft = { id: draftId, state: "pending", expires_at: new Date(Date.now() + 60_000).toISOString(), arguments_hash: "h".repeat(64), actor_session_id: activityId, revision };

  it("strips the fingerprint and the session and reads a pending draft past expiry as expired", () => {
    expect(presentDraft(draft)).toEqual({ id: draftId, state: "pending", expires_at: draft.expires_at, revision });
    const stale = { ...draft, expires_at: new Date(Date.now() - 1000).toISOString() };
    expect(presentDraft(stale).state).toBe("expired");
    expect(presentDraft({ ...stale, state: "reconciled" }).state).toBe("reconciled");
    expect(presentDraft({ ...draft, expires_at: null }).state).toBe("pending");
  });

  it("recognises the four RPC replies and refuses a saved reconciliation without a record", () => {
    expect(isSaveDraftOutcome({ draft: { id: draftId }, replayed: false })).toBe(true);
    expect(isSaveDraftOutcome({ draft: { id: draftId } })).toBe(false);
    expect(isReconcileOutcome({ draft: { id: draftId }, outcome: "unsaved" })).toBe(true);
    expect(isReconcileOutcome({ draft: { id: draftId }, outcome: "saved", record: { id: receiptId } })).toBe(true);
    expect(isReconcileOutcome({ draft: { id: draftId }, outcome: "saved" })).toBe(false);
    expect(isReconcileOutcome({ draft: { id: draftId }, outcome: "done" })).toBe(false);
    expect(isResumeOutcome({ draft: { id: draftId }, outcome: "saved", reply: { receipt: { id: receiptId } } })).toBe(true);
    expect(isResumeOutcome({ draft: { id: draftId }, outcome: "unsaved" })).toBe(false);
    expect(isDiscardOutcome({ draft: { id: draftId, state: "discarded" } })).toBe(true);
    expect(isDiscardOutcome({ draft: { id: draftId, state: "pending" } })).toBe(false);
    expect(isDiscardOutcome({ draft: { id: draftId } })).toBe(false);
  });

  it("presents a resumed reply exactly as the original route would and strips fingerprints", () => {
    const receipt = { id: receiptId, request_hash: "f".repeat(64), completion_state: "completed" };
    const occurrence = { id: occurrenceId, status: "completed" };
    expect(presentResumedReply("record_work", { receipt, occurrence, issue: null, replayed: true })).toEqual({ outcome: "receipt", receipt: { id: receiptId, completion_state: "completed" }, occurrence, issue: null, replayed: true });
    expect(presentResumedReply("correct_work", { receipt, occurrence, issue: { id: activityId, request_hash: "x" }, replayed: false })).toEqual({ outcome: "receipt", receipt: { id: receiptId, completion_state: "completed" }, occurrence, issue: { id: activityId }, replayed: false });
    expect(presentResumedReply("report_issue", { issue: { id: activityId, request_hash: "x", status: "open" }, replayed: false })).toEqual({ outcome: "receipt", issue: { id: activityId, status: "open" }, replayed: false });
    expect(presentResumedReply("report_issue", { receipt, occurrence, issue: null, replayed: false })).toBeNull();
    expect(presentResumedReply("record_work", { ok: true })).toBeNull();
  });
});

describe("draft error mapping", () => {
  it("hides another actor's key on save and reads another actor's draft as absent elsewhere", () => {
    expect(mapDraftRpcError({ code: "42501", message: "Operation unavailable" }, "save")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapDraftRpcError({ code: "42501", message: "Operation unavailable" }, "reconcile")).toEqual({ status: 404, outcome: "missing", error: "Draft not found" });
    expect(mapDraftRpcError({ code: "P0002", message: "Draft not found" }, "resume")).toEqual({ status: 404, outcome: "missing", error: "Draft not found" });
  });

  it("maps a changed replay to a conflict and expiry or discard to their outcomes", () => {
    expect(mapDraftRpcError({ code: "P0001", message: "This request was already saved with different content" }, "save")).toEqual({ status: 409, outcome: "conflict", error: "This request was already saved with different content" });
    expect(mapDraftRpcError({ code: "P0001", message: "Draft has expired" }, "resume")).toEqual({ status: 409, outcome: "expired", error: "Draft has expired" });
    expect(mapDraftRpcError({ code: "P0001", message: "Draft was discarded" }, "resume")).toEqual({ status: 409, outcome: "discarded", error: "Draft was discarded" });
  });

  it("passes trusted validation wording through, hides untrusted wording and reports the rest as uncertain", () => {
    expect(mapDraftRpcError({ code: "22023", message: "Arguments must be at most 64 KiB" }, "save")).toEqual({ status: 400, outcome: "validation", error: "Arguments must be at most 64 KiB" });
    const untrusted = mapDraftRpcError({ code: "22023", message: "relation operation_command_drafts column x" }, "save");
    expect(untrusted).toEqual({ status: 400, outcome: "validation", error: "Draft request contains an invalid value" });
    const unknown = mapDraftRpcError({ code: "40P01", message: "deadlock detected on operation_command_drafts" }, "discard");
    expect(unknown.status).toBe(500);
    expect(unknown.outcome).toBe("uncertain");
    expect(unknown.error).not.toContain("deadlock");
    expect(mapDraftRpcError({ code: "P0001", message: "something internal" }, "save")).toEqual({ status: 409, outcome: "conflict", error: "Draft request could not be completed. Check the draft and retry." });
  });

  it("maps a resumed command's own error as the original route would and draft refusals as draft outcomes", () => {
    expect(mapResumeRpcError({ code: "P0001", message: "Receipt changed since it was read" }, "correct_work")).toMatchObject({ status: 409, outcome: "conflict", error: "Receipt changed since it was read" });
    expect(mapResumeRpcError({ code: "42501", message: "A different authorized staff member must verify this task" }, "verify_work")).toEqual({ status: 409, outcome: "conflict", error: "A different authorized staff member must verify this task" });
    expect(mapResumeRpcError({ code: "22023", message: "Recorded values are invalid: run_minutes is required" }, "record_work")).toEqual({ status: 400, outcome: "validation", error: "Recorded values are invalid: run_minutes is required" });
    expect(mapResumeRpcError({ code: "23505", message: "duplicate key", details: `current_receipt_id=${receiptId}` }, "record_work")).toEqual({ status: 409, outcome: "conflict", error: "Record request conflicts with an existing receipt", current_receipt_id: receiptId });
    // COL-145: corrections and reversals carry their own nouns and the current receipt's revision when the database names it.
    expect(mapResumeRpcError({ code: "23505", message: "duplicate key" }, "correct_work")).toEqual({ status: 409, outcome: "conflict", error: "Correction request conflicts with an existing receipt" });
    expect(mapResumeRpcError({ code: "40P01", message: "deadlock" }, "reverse_work")).toMatchObject({ status: 500, outcome: "uncertain", error: expect.stringContaining("Reversal") });
    const stale = mapResumeRpcError({ code: "P0001", message: "Receipt changed since it was read", details: `current_receipt_id=${receiptId} current_receipt_revision=${revision}` }, "correct_work");
    expect(stale).toEqual({ status: 409, outcome: "conflict", error: "Receipt changed since it was read", current_receipt_id: receiptId, current_receipt_revision: revision });
    expect(resumeErrorFields(stale)).toEqual({ current_receipt_id: receiptId, current_receipt_revision: revision });
    expect(resumeErrorFields(mapResumeRpcError({ code: "P0001", message: "Draft has expired" }, "correct_work"))).toEqual({});
    expect(mapResumeRpcError({ code: "42501", message: "Operation unavailable" }, "report_issue")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapResumeRpcError({ code: "P0001", message: "Draft has expired" }, "record_work")).toEqual({ status: 409, outcome: "expired", error: "Draft has expired" });
    expect(mapResumeRpcError({ code: "P0001", message: "Draft was discarded" }, "correct_work")).toEqual({ status: 409, outcome: "discarded", error: "Draft was discarded" });
    // Another session resumed first: a draft-level conflict, never a receipt error.
    expect(mapResumeRpcError({ code: "P0001", message: "Draft is not pending" }, "verify_work")).toEqual({ status: 409, outcome: "conflict", error: "Draft is not pending" });
    expect(mapResumeRpcError({ code: "P0002", message: "Draft not found" }, "record_work")).toEqual({ status: 404, outcome: "missing", error: "Draft not found" });
  });
});

describe("draft session read", () => {
  const maybeSingle = vi.fn();
  const from = vi.fn(() => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) query[method] = vi.fn(() => query);
    query.maybeSingle = maybeSingle;
    return query;
  });
  const actor = { id: "actor", organizationId: "org", appRole: "housekeeper", currentActor: { client: { from } } } as never;
  const row = { id: draftId, organization_id: "org", facility_id: facilityId, actor_id: "actor", state: "pending", target_id: occurrenceId, command: "record_work" };

  it("reads the caller's own draft and treats other actors, other organisations and ungranted sites as absent", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
    maybeSingle.mockResolvedValueOnce({ data: row, error: null });
    expect(await readDraftTarget(actor, draftId, "scope")).toEqual({ target: row });
    expect(from).toHaveBeenCalledWith("operation_command_drafts");
    for (const variant of [{ ...row, actor_id: "someone-else" }, { ...row, organization_id: "other" }, null]) {
      maybeSingle.mockResolvedValueOnce({ data: variant, error: null });
      const result = await readDraftTarget(actor, draftId, "scope");
      expect("response" in result && result.response.status).toBe(404);
    }
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    maybeSingle.mockResolvedValueOnce({ data: row, error: null });
    const ungranted = await readDraftTarget(actor, draftId, "scope");
    expect("response" in ungranted && (await ungranted.response.json())).toEqual({ error: "Draft not found", outcome: "missing" });
  });

  it("refuses a malformed id before reading and reports a read failure as uncertain", async () => {
    from.mockClear();
    const malformed = await readDraftTarget(actor, "not-a-uuid", "scope");
    expect("response" in malformed && malformed.response.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    const failed = await readDraftTarget(actor, draftId, "scope");
    expect("response" in failed && failed.response.status).toBe(503);
  });
});
