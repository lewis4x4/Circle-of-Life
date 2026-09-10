import { describe, expect, it } from "vitest";

import {
  EVIDENCE_COMMAND_RPC,
  EVIDENCE_MAX_BYTES,
  failEvidenceBodySchema,
  finalizeEvidenceBodySchema,
  isAttached,
  isEvidenceOutcome,
  mapEvidenceRpcError,
  mayCarryPath,
  prepareEvidenceBodySchema,
  presentEvidence,
  uploadedEvidenceBodySchema,
  evidencePayloadProblem,
} from "./evidence";

const receiptId = "77777777-7777-4777-8777-777777777777";
const key = "evidence:2026-09-10:0001";
const revision = "a".repeat(64);
const photo = { kind: "photo", rule_label: "Panel photo", filename: "panel.jpg", mime: "image/jpeg", size_bytes: 1024 };

describe("evidence request shapes", () => {
  it("names the four commands' RPCs", () => {
    expect(EVIDENCE_COMMAND_RPC).toEqual({
      prepare: "prepare_operation_evidence_review",
      uploaded: "mark_operation_evidence_uploaded_review",
      finalize: "finalize_operation_evidence_review",
      fail: "fail_operation_evidence_review",
    });
  });

  it("accepts an object kind with a plain filename, an allowed type and a bounded size", () => {
    const parsed = prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, sha256: "b".repeat(64) } });
    expect(parsed.success).toBe(true);
  });

  it("refuses a disallowed type, an oversize file, a path-like filename and an unknown field", () => {
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, mime: "text/html" } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, size_bytes: EVIDENCE_MAX_BYTES + 1 } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, filename: "../panel.jpg" } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, object_path: "x/y" } }).success).toBe(false);
    const problem = prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, size_bytes: 0 } });
    expect(problem.success).toBe(false);
    if (!problem.success) expect(evidencePayloadProblem(problem.error)).toMatch(/^payload\.size_bytes: /);
  });

  it("accepts a linked record only with a known table and refuses object fields on it", () => {
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId } }).success).toBe(true);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "residents", linked_record_id: receiptId } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId, filename: "x.pdf" } }).success).toBe(false);
  });

  it("requires the receipt revision to finalize and a reason to fail", () => {
    expect(finalizeEvidenceBodySchema.safeParse({ request_key: key, expected_receipt_revision: revision }).success).toBe(true);
    expect(finalizeEvidenceBodySchema.safeParse({ request_key: key, expected_receipt_revision: "short" }).success).toBe(false);
    expect(finalizeEvidenceBodySchema.safeParse({ request_key: key, expected_receipt_revision: revision, payload: { sha256: "zz" } }).success).toBe(false);
    expect(failEvidenceBodySchema.safeParse({ request_key: key, payload: { reason: " " } }).success).toBe(false);
    expect(failEvidenceBodySchema.safeParse({ request_key: key, payload: { reason: "Camera upload timed out" } }).success).toBe(true);
    expect(uploadedEvidenceBodySchema.safeParse({ request_key: "short" }).success).toBe(false);
  });
});

describe("evidence presentation", () => {
  const own = { id: "e1", state: "prepared", uploaded_by: "actor", object_path: "f/e1/panel.jpg", request_hash: "h" };

  it("attaches only finalized rows", () => {
    expect(isAttached({ state: "finalized" })).toBe(true);
    for (const state of ["prepared", "uploaded", "failed"]) expect(isAttached({ state })).toBe(false);
  });

  it("returns the object path only to the uploader of an in-flight row", () => {
    expect(mayCarryPath(own, "actor")).toBe(true);
    expect(mayCarryPath(own, "someone-else")).toBe(false);
    expect(mayCarryPath({ ...own, state: "finalized" }, "actor")).toBe(false);
    expect(presentEvidence(own, "actor")).toEqual({ id: "e1", state: "prepared", uploaded_by: "actor", object_path: "f/e1/panel.jpg" });
    expect(presentEvidence(own, "someone-else")).toEqual({ id: "e1", state: "prepared", uploaded_by: "actor" });
    expect(presentEvidence({ ...own, state: "finalized" }, "actor")).toEqual({ id: "e1", state: "finalized", uploaded_by: "actor" });
  });

  it("recognises the command outcome shape", () => {
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false })).toBe(true);
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false, satisfaction: { evidence_status_current: "complete" } })).toBe(true);
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, replayed: false })).toBe(false);
  });
});

describe("evidence outcome classes", () => {
  it("hides denials and maps a missing row", () => {
    expect(mapEvidenceRpcError({ code: "42501", message: "Operation unavailable" }, "prepare")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapEvidenceRpcError({ code: "P0002", message: "no rows" }, "finalize")).toEqual({ status: 404, outcome: "missing", error: "Evidence not found" });
  });

  it("passes trusted validation wording through and hides internal 22023 detail behind the command noun", () => {
    // Every 22023 wording migration 343 raises, verbatim.
    for (const message of [
      "Evidence rule does not apply to this receipt", "Evidence kind does not match the rule", "kind must be document, photo, signature or linked_record", "rule_label must be at most 200 characters",
      "A linked record carries no object", "An object kind carries no linked record", "linked_table must be facility_documents or employee_file_records", "filename must be 1 to 120 safe characters",
      "mime must be application/pdf, image/jpeg, image/png or image/webp", "size_bytes must be a whole number of bytes up to 20 MiB", "sha256 must be 64 hex characters", "A request key is required",
      "An expected receipt revision is required", "reason must be text of at most 2000 characters",
    ]) {
      expect(mapEvidenceRpcError({ code: "22023", message }, "prepare")).toEqual({ status: 400, outcome: "validation", error: message });
    }
    // Object and checksum mismatches are raised as P0001 but are value problems the uploader can act on.
    for (const message of ["Uploaded object does not match the prepared evidence", "sha256 does not match the prepared evidence"]) {
      expect(mapEvidenceRpcError({ code: "P0001", message }, "finalize")).toEqual({ status: 400, outcome: "validation", error: message });
    }
    expect(mapEvidenceRpcError({ code: "22023", message: "column x of relation y" }, "uploaded")).toEqual({ status: 400, outcome: "validation", error: "Upload confirmation contains an invalid value" });
  });

  it("maps state, revision and replay refusals to conflict verbatim, naming existing evidence when the database does", () => {
    // Every P0001 state wording migration 343 raises, verbatim.
    for (const message of [
      "Receipt changed since it was read", "Evidence rule is already satisfied", "Evidence is already finalized", "Evidence is already uploaded", "Evidence has failed", "Evidence belongs to another uploader",
      "Evidence attaches to the effective performance receipt", "Uploaded object not found for this evidence", "Linked record is not readable for this receipt", "This request was already saved with different content",
    ]) {
      expect(mapEvidenceRpcError({ code: "P0001", message }, "finalize")).toEqual({ status: 409, outcome: "conflict", error: message });
    }
    const existing = "99999999-9999-4999-8999-999999999999";
    expect(mapEvidenceRpcError({ code: "P0001", message: "Evidence already finalized for these bytes", details: `evidence_id=${existing}` }, "prepare")).toEqual({
      status: 409, outcome: "conflict", error: "Evidence already finalized for these bytes", existing_evidence_id: existing,
    });
    expect(mapEvidenceRpcError({ code: "23505", message: "duplicate key value violates unique constraint operation_evidence_bytes" }, "prepare")).toEqual({ status: 409, outcome: "conflict", error: "Evidence preparation conflicts with existing evidence" });
    expect(mapEvidenceRpcError({ code: "23514", message: "new row for relation violates check constraint" }, "fail")).toEqual({ status: 409, outcome: "conflict", error: "Upload failure report could not be completed. Refresh the evidence and retry." });
  });

  it("treats an unknown code as uncertain without echoing it", () => {
    const mapped = mapEvidenceRpcError({ code: "57014", message: "canceling statement due to statement timeout" }, "finalize");
    expect(mapped).toEqual({ status: 500, outcome: "uncertain", error: "Evidence finalization could not be confirmed; re-read the evidence before retrying" });
    expect(mapEvidenceRpcError({ code: "23503", message: "fk" }, "prepare")).toEqual({ status: 400, outcome: "validation", error: "Evidence preparation contains an invalid reference or value" });
  });
});
