import { describe, expect, it } from "vitest";

import {
  COMPLETION_STATES,
  RECEIPT_KINDS,
  RECEIPT_SELECT,
  correctWorkBodySchema,
  currentReceiptFields,
  isCorrectionOutcome,
  isIssueOutcome,
  isReceiptOutcome,
  isReversalOutcome,
  mapReceiptRpcError,
  payloadProblem,
  recordWorkBodySchema,
  reportIssueBodySchema,
  reverseWorkBodySchema,
  verifyWorkBodySchema,
  withoutRequestHash,
} from "./receipts";

const uuid = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";
const key = "record:2026-09-10:0001";
const revision = "a".repeat(64);
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const binding = { receipt_id: receiptId, receipt_revision: revision };

describe("record work payload", () => {
  it("accepts a routine self record with flat typed values and refuses nested values or unknown fields", () => {
    const body = { request_key: key, payload: { outcome: "performed", values: { run_minutes: 12, reading_ok: true, note_text: "clear" }, note: "Generator ran" } };
    expect(recordWorkBodySchema.safeParse(body).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", values: { nested: { a: 1 } } } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", recorder_id: uuid } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: "short", payload: { outcome: "performed" } }).success).toBe(false);
  });

  it("refuses a future performed time and names the problem", () => {
    const result = recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performed_at: future } });
    expect(result.success).toBe(false);
    if (!result.success) expect(payloadProblem(result.error)).toBe("Performed time cannot be in the future");
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performed_at: past, entry_kind: "late", entry_reason: "Recorded after the shift" } }).success).toBe(true);
  });

  it("couples late and on-behalf entries with a reason and an explicit performer kind", () => {
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", entry_kind: "late" } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: uuid } } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: uuid }, entry_kind: "on_behalf", entry_reason: "Covered the shift" } }).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "vendor", vendor_id: uuid, label: "Generator service" }, entry_kind: "on_behalf", entry_reason: "Vendor visit" } }).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "unknown_historical", label: "Previous administrator" }, entry_kind: "on_behalf", entry_reason: "Paper log" } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "unknown_historical", label: "Previous administrator" }, entry_kind: "late", entry_reason: "Paper log", performed_at: past } }).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "self", user_id: uuid } } }).success).toBe(false);
  });

  it("requires an issue for a failed outcome and a reason for not performed", () => {
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "failed" } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "failed", issue: { kind: "failed_result", summary: "Generator did not start" } } }).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "not_performed" } }).success).toBe(false);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "not_performed", entry_reason: "Area closed for repair" } }).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", issue: { kind: "problem", summary: "", severity: "high" } } }).success).toBe(false);
  });

  it("keeps verification to a decision, a note and the reviewed receipt, and issue reports to one scope", () => {
    expect(verifyWorkBodySchema.safeParse({ request_key: key, payload: { decision: "verified", note: "Checked the panel photo", ...binding } }).success).toBe(true);
    expect(verifyWorkBodySchema.safeParse({ request_key: key, payload: { decision: "rejected", ...binding } }).success).toBe(false);
    // COL-145: a review is bound to the exact receipt the reviewer read; the route refuses an unbound review.
    expect(verifyWorkBodySchema.safeParse({ request_key: key, payload: { decision: "verified" } }).success).toBe(false);
    expect(verifyWorkBodySchema.safeParse({ request_key: key, payload: { decision: "verified", receipt_id: receiptId } }).success).toBe(false);
    expect(verifyWorkBodySchema.safeParse({ request_key: key, payload: { decision: "verified", receipt_id: receiptId, receipt_revision: "notahash" } }).success).toBe(false);
    expect(verifyWorkBodySchema.safeParse({ request_key: key, payload: { decision: "verified", receipt_id: "nobody", receipt_revision: revision } }).success).toBe(false);
    expect(reportIssueBodySchema.safeParse({ request_key: key, payload: { task_instance_id: uuid, kind: "help_request", summary: "Need a ladder" } }).success).toBe(true);
    expect(reportIssueBodySchema.safeParse({ request_key: key, payload: { activity_id: uuid, facility_id: uuid, subject_id: uuid, kind: "problem", summary: "Leak under the sink" } }).success).toBe(true);
    expect(reportIssueBodySchema.safeParse({ request_key: key, payload: { activity_id: uuid, kind: "problem", summary: "Leak" } }).success).toBe(false);
    expect(reportIssueBodySchema.safeParse({ request_key: key, payload: { task_instance_id: uuid, facility_id: uuid, kind: "problem", summary: "Leak" } }).success).toBe(false);
  });
});

describe("correction and reversal bodies", () => {
  const expected = { expected_receipt_id: receiptId, expected_receipt_revision: revision };

  it("requires the corrected receipt, its revision, a full work statement and a reason", () => {
    const body = { request_key: key, ...expected, payload: { outcome: "performed", values: { run_minutes: 14 }, note: "Corrected the run time", reason: "Typed 12 instead of 14" } };
    const parsed = correctWorkBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.payload).toEqual(body.payload);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed" } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", reason: "  " } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", reason: "x".repeat(2001) } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, expected_receipt_id: receiptId, payload: { outcome: "performed", reason: "Fix" } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, expected_receipt_id: receiptId, expected_receipt_revision: "stale", payload: { outcome: "performed", reason: "Fix" } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", reason: "Fix", recorder_id: uuid } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", reason: "Fix", values: { nested: { a: 1 } } } }).success).toBe(false);
  });

  it("applies the shared statement rules, letting the correction reason stand in for a late or on-behalf entry reason", () => {
    const failed = correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "failed", reason: "Result was actually a failure" } });
    expect(failed.success).toBe(false);
    if (!failed.success) expect(payloadProblem(failed.error)).toBe("a failed outcome requires an issue");
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "failed", reason: "Result was actually a failure", issue: { kind: "failed_result", summary: "Generator stalled" } } }).success).toBe(true);
    const futureCorrection = correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", performed_at: future, reason: "Wrong time" } });
    expect(futureCorrection.success).toBe(false);
    if (!futureCorrection.success) expect(payloadProblem(futureCorrection.error)).toBe("Performed time cannot be in the future");
    // The database takes the correction reason as the entry reason of a late entry; a recording still needs its own.
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", performed_at: past, entry_kind: "late", reason: "Performed earlier than recorded" } }).success).toBe(true);
    expect(recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performed_at: past, entry_kind: "late" } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: uuid }, reason: "Wrong performer" } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: uuid }, entry_kind: "on_behalf", reason: "Wrong performer" } }).success).toBe(true);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "not_performed", reason: "Area was closed" } }).success).toBe(false);
    expect(correctWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { outcome: "not_performed", entry_reason: "Area closed for repair", reason: "Recorded against the wrong day" } }).success).toBe(true);
  });

  it("keeps a reversal to the named receipt and a reason", () => {
    expect(reverseWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { reason: "Recorded on the wrong occurrence" } }).success).toBe(true);
    expect(reverseWorkBodySchema.safeParse({ request_key: key, ...expected, payload: {} }).success).toBe(false);
    expect(reverseWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { reason: "" } }).success).toBe(false);
    expect(reverseWorkBodySchema.safeParse({ request_key: key, ...expected, payload: { reason: "Wrong occurrence", outcome: "performed" } }).success).toBe(false);
    expect(reverseWorkBodySchema.safeParse({ request_key: key, expected_receipt_id: receiptId, payload: { reason: "Wrong occurrence" } }).success).toBe(false);
    expect(reverseWorkBodySchema.safeParse({ request_key: key, payload: { reason: "Wrong occurrence" } }).success).toBe(false);
  });

  it("reads the whole chain: kinds, states and the supersession and binding columns", () => {
    expect(RECEIPT_KINDS).toContain("reversal");
    expect(COMPLETION_STATES).toContain("reversed");
    for (const column of ["chain_id", "corrects_receipt_id", "correction_reason", "correction_seq", "superseded_at", "superseded_by_receipt_id", "verifies_receipt_id", "verified_receipt_revision", "revision"]) {
      expect(RECEIPT_SELECT.split(", ")).toContain(column);
    }
  });
});

describe("receipt outcome classes", () => {
  it("hides existence on authority denial and reports validation with the database wording", () => {
    expect(mapReceiptRpcError({ code: "42501", message: "Task actor is no longer authorized" })).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapReceiptRpcError({ code: "22023", message: "Performed time cannot be in the future" })).toEqual({ status: 400, outcome: "validation", error: "Performed time cannot be in the future" });
    expect(mapReceiptRpcError({ code: "22023", message: "Recorded values are invalid: run_minutes must be a number" })).toMatchObject({ status: 400, outcome: "validation" });
    expect(mapReceiptRpcError({ code: "22023", message: "internal detail column x" })).toEqual({ status: 400, outcome: "validation", error: "Record request contains an invalid value" });
    for (const wording of ["Performer is not current staff at this site", "Performer vendor is not linked to this site", "A failed outcome requires an issue", "not_performed requires entry_reason", "An unknown historical performer requires a late entry", "Work performed more than fifteen minutes before recording must be entered as late"]) {
      expect(mapReceiptRpcError({ code: "22023", message: wording })).toEqual({ status: 400, outcome: "validation", error: wording });
    }
  });

  it("names the first structural payload problem when no custom rule fired", () => {
    const long = recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", entry_kind: "late", entry_reason: "x".repeat(2001) } });
    expect(long.success).toBe(false);
    if (!long.success) expect(payloadProblem(long.error)).toMatch(/^payload\.entry_reason: /);
    const malformed = recordWorkBodySchema.safeParse({ request_key: key, payload: { outcome: "performed", performer: { kind: "other_staff", user_id: "nobody" }, entry_kind: "on_behalf", entry_reason: "Covered" } });
    expect(malformed.success).toBe(false);
    if (!malformed.success) expect(payloadProblem(malformed.error)).toMatch(/^payload\.performer\.user_id: /);
    expect(withoutRequestHash({ id: receiptId, request_key: key, request_hash: "abc" })).toEqual({ id: receiptId, request_key: key });
  });

  it("reports conflicts with the current receipt when the database names it", () => {
    const mapped = mapReceiptRpcError({ code: "23505", message: "Work is already recorded for this occurrence", details: `current_receipt_id=${receiptId}` });
    expect(mapped).toEqual({ status: 409, outcome: "conflict", error: "Work is already recorded for this occurrence", current_receipt_id: receiptId });
    expect(mapReceiptRpcError({ code: "P0001", message: "This request was already saved with different content" })).toEqual({ status: 409, outcome: "conflict", error: "This request was already saved with different content" });
    expect(mapReceiptRpcError({ code: "P0001", message: "Required evidence is missing" })).toEqual({ status: 409, outcome: "conflict", error: "Required evidence is missing" });
    // The database raises independence as 42501; the reviewer can act on it, so it is a conflict, not a hidden denial.
    expect(mapReceiptRpcError({ code: "42501", message: "A different authorized staff member must verify this task" }, "verify")).toEqual({ status: 409, outcome: "conflict", error: "A different authorized staff member must verify this task" });
    expect(mapReceiptRpcError({ code: "23505", message: "duplicate key value violates unique constraint operation_execution_receipts_effective" })).toEqual({ status: 409, outcome: "conflict", error: "Record request conflicts with an existing receipt" });
    expect(mapReceiptRpcError({ code: "23505", message: "duplicate key value violates unique constraint operation_issues_request_key_key" }, "issue")).toEqual({ status: 409, outcome: "conflict", error: "Issue report conflicts with an existing issue" });
    expect(mapReceiptRpcError({ code: "P0001", message: "no governing requirement version" }, "verify")).toEqual({ status: 409, outcome: "conflict", error: "Verification request could not be completed. Refresh the occurrence and retry." });
    expect(mapReceiptRpcError({ code: "23514", message: "check constraint private_receipt_shape violated" })).toEqual({ status: 409, outcome: "conflict", error: "Record request could not be completed. Refresh the occurrence and retry." });
  });

  it("names the current receipt and its revision when a correction, reversal or review reads a stale receipt", () => {
    const details = `current_receipt_id=${receiptId};current_receipt_revision=${revision}`;
    const stale = { code: "P0001", message: "Receipt changed since it was read", details };
    for (const command of ["correct", "reverse", "verify"] as const) {
      const mapped = mapReceiptRpcError(stale, command);
      expect(mapped).toEqual({ status: 409, outcome: "conflict", error: "Receipt changed since it was read", current_receipt_id: receiptId, current_receipt_revision: revision });
      expect(currentReceiptFields(mapped)).toEqual({ current_receipt_id: receiptId, current_receipt_revision: revision });
    }
    // The 341 duplicate-work conflict still names only the receipt; a revision alone names nothing.
    const legacy = mapReceiptRpcError({ code: "23505", message: "Work is already recorded for this occurrence", details: `current_receipt_id=${receiptId}` }, "record");
    expect(legacy).toEqual({ status: 409, outcome: "conflict", error: "Work is already recorded for this occurrence", current_receipt_id: receiptId });
    expect(currentReceiptFields(legacy)).toEqual({ current_receipt_id: receiptId });
    expect(mapReceiptRpcError({ code: "P0001", message: "Receipt changed since it was read", details: `current_receipt_revision=${revision}` }, "correct")).toEqual({ status: 409, outcome: "conflict", error: "Receipt changed since it was read" });
    expect(currentReceiptFields({ status: 500, outcome: "uncertain", error: "x" })).toEqual({});
  });

  it("classifies the correction and reversal refusals with their command nouns", () => {
    expect(mapReceiptRpcError({ code: "22023", message: "Corrected performed time cannot be after the original recording" }, "correct")).toEqual({ status: 400, outcome: "validation", error: "Corrected performed time cannot be after the original recording" });
    expect(mapReceiptRpcError({ code: "22023", message: "Work performed more than fifteen minutes before recording must be entered as late" }, "correct")).toMatchObject({ status: 400, outcome: "validation" });
    expect(mapReceiptRpcError({ code: "22023", message: "reason is required" }, "correct")).toEqual({ status: 400, outcome: "validation", error: "reason is required" });
    expect(mapReceiptRpcError({ code: "22023", message: "internal detail column x" }, "correct")).toEqual({ status: 400, outcome: "validation", error: "Correction request contains an invalid value" });
    // 344 raises the same wording for a reversal without recorded work and for correcting or reversing a reversal.
    expect(mapReceiptRpcError({ code: "P0001", message: "Occurrence has no recorded work" }, "reverse")).toEqual({ status: 409, outcome: "conflict", error: "Occurrence has no recorded work" });
    expect(mapReceiptRpcError({ code: "P0001", message: "Occurrence has no recorded work" }, "correct")).toEqual({ status: 409, outcome: "conflict", error: "Occurrence has no recorded work" });
    expect(mapReceiptRpcError({ code: "P0001", message: "Managed occurrences cannot be deferred by the legacy command" }, "correct")).toEqual({ status: 409, outcome: "conflict", error: "Managed occurrences cannot be deferred by the legacy command" });
    expect(mapReceiptRpcError({ code: "P0001", message: "no governing requirement version" }, "reverse")).toEqual({ status: 409, outcome: "conflict", error: "Reversal request could not be completed. Refresh the occurrence and retry." });
    expect(mapReceiptRpcError({ code: "23505", message: "duplicate key value violates unique constraint operation_execution_receipts_effective" }, "correct")).toEqual({ status: 409, outcome: "conflict", error: "Correction request conflicts with an existing receipt" });
    expect(mapReceiptRpcError({ code: "42501", message: "Task actor is no longer authorized" }, "reverse")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapReceiptRpcError({ code: "57014", message: "statement timeout" }, "correct")).toEqual({ status: 500, outcome: "uncertain", error: "Correction could not be confirmed; check the occurrence before retrying" });
    expect(mapReceiptRpcError({ code: "57014", message: "statement timeout" }, "reverse")).toEqual({ status: 500, outcome: "uncertain", error: "Reversal could not be confirmed; check the occurrence before retrying" });
  });

  it("recognises correction and reversal outcomes only with the receipt they superseded", () => {
    const base = { receipt: { id: receiptId }, corrected: { id: uuid }, occurrence: { id: uuid }, replayed: false };
    expect(isCorrectionOutcome({ ...base, issue: null, verification_superseded_receipt_id: null })).toBe(true);
    expect(isCorrectionOutcome({ ...base, issue: { id: uuid }, verification_superseded_receipt_id: receiptId })).toBe(true);
    expect(isCorrectionOutcome({ ...base, issue: null })).toBe(true);
    expect(isCorrectionOutcome({ ...base, issue: null, verification_superseded_receipt_id: 7 })).toBe(false);
    expect(isCorrectionOutcome({ receipt: { id: receiptId }, occurrence: { id: uuid }, issue: null, replayed: false })).toBe(false);
    expect(isCorrectionOutcome({ ...base, corrected: {}, issue: null })).toBe(false);
    const reversal = { receipt: { id: receiptId }, reversed: { id: uuid }, occurrence: { id: uuid }, verification_superseded_receipt_id: null, replayed: false };
    expect(isReversalOutcome(reversal)).toBe(true);
    expect(isReversalOutcome({ ...reversal, verification_superseded_receipt_id: receiptId })).toBe(true);
    expect(isReversalOutcome({ ...reversal, verification_superseded_receipt_id: undefined })).toBe(true);
    expect(isReversalOutcome({ ...reversal, verification_superseded_receipt_id: 7 })).toBe(false);
    // A correction reply names the superseded receipt as `corrected`, never `reversed`.
    expect(isReversalOutcome({ ...base, issue: null, verification_superseded_receipt_id: null })).toBe(false);
    expect(isReversalOutcome({ ...reversal, reversed: {} })).toBe(false);
    expect(isReversalOutcome({ ...reversal, replayed: "no" })).toBe(false);
    expect(isReversalOutcome(null)).toBe(false);
  });

  it("classifies missing and uncertain outcomes without echoing detail", () => {
    expect(mapReceiptRpcError({ code: "P0002", message: "query returned no rows" })).toEqual({ status: 404, outcome: "missing", error: "Occurrence not found" });
    expect(mapReceiptRpcError({ code: "23503", message: "violates foreign key" })).toMatchObject({ status: 400, outcome: "validation" });
    const uncertain = mapReceiptRpcError({ code: "57014", message: "canceling statement due to statement timeout on relation operation_execution_receipts" });
    expect(uncertain).toEqual({ status: 500, outcome: "uncertain", error: "Record could not be confirmed; check the occurrence before retrying" });
  });

  it("recognises receipt and issue outcomes only with their identities", () => {
    expect(isReceiptOutcome({ receipt: { id: receiptId }, occurrence: { id: uuid, status: "completed" }, issue: null, replayed: false })).toBe(true);
    expect(isReceiptOutcome({ receipt: { id: receiptId }, occurrence: { id: uuid }, issue: { id: uuid }, replayed: true })).toBe(true);
    expect(isReceiptOutcome({ receipt: { id: receiptId }, replayed: false })).toBe(false);
    expect(isReceiptOutcome({ receipt: { id: receiptId }, occurrence: { id: uuid }, issue: "created", replayed: false })).toBe(false);
    expect(isIssueOutcome({ issue: { id: uuid }, replayed: false })).toBe(true);
    expect(isIssueOutcome({ issue: {}, replayed: false })).toBe(false);
  });
});
