import { describe, expect, it } from "vitest";

import {
  CHECKSUM_UNVERIFIABLE_WORDING,
  EVIDENCE_COMMAND_RPC,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_SELECT,
  evidenceResultReply,
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
const md5 = "900150983cd24fb0d6963f7d28e17f72";
const photo = { kind: "photo", rule_label: "Panel photo", filename: "panel.jpg", mime: "image/jpeg", size_bytes: 1024, md5 };

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

  it("requires the declared MD5 on every object kind, as 32 lowercase hex characters, and keeps sha256 optional", () => {
    for (const kind of ["document", "photo", "signature"]) {
      expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, kind, rule_label: undefined } }).success).toBe(true);
      const missing = prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, kind, md5: undefined } });
      expect(missing.success).toBe(false);
      if (!missing.success) expect(evidencePayloadProblem(missing.error)).toMatch(/^payload\.md5: /);
    }
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, md5: md5.toUpperCase() } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, md5: md5.slice(1) } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { ...photo, sha256: "b".repeat(64) } }).success).toBe(true);
  });

  it("accepts a linked record only with a known table and refuses object fields, including md5, on it", () => {
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId } }).success).toBe(true);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "residents", linked_record_id: receiptId } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId, filename: "x.pdf" } }).success).toBe(false);
    expect(prepareEvidenceBodySchema.safeParse({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId, md5 } }).success).toBe(false);
  });

  it("reads the checksum columns with the evidence", () => {
    for (const column of ["declared_md5", "checksum_verified", "checksum_method", "checksum_verified_at", "object_version", "object_etag"]) expect(EVIDENCE_SELECT.split(", ")).toContain(column);
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

  it("recognises the command outcome shape, which always names what the command did", () => {
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false, outcome: "uploaded" })).toBe(true);
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false, satisfaction: { evidence_status_current: "complete" }, outcome: "finalized" })).toBe(true);
    for (const outcome of ["prepared", "failed", "checksum_mismatch", "checksum_unverifiable", "object_changed"]) {
      expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false, outcome })).toBe(true);
    }
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false })).toBe(false);
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, event: { id: "v1" }, replayed: false, outcome: "verified" })).toBe(false);
    expect(isEvidenceOutcome({ evidence: { id: "e1" }, replayed: false, outcome: "uploaded" })).toBe(false);
  });

  it("classifies command results: plain transitions are receipts, checksum failures are 409 with the failed row, an unverifiable checksum is 409 uncertain", () => {
    const event = { id: "v1", event_kind: "uploaded", request_hash: "h" };
    const uploaded = evidenceResultReply({ evidence: { ...own, state: "uploaded" }, event, replayed: false, outcome: "uploaded" }, "actor", "uploaded");
    expect(uploaded).toEqual({ status: 200, body: { outcome: "receipt", evidence_outcome: "uploaded", evidence: { id: "e1", state: "uploaded", uploaded_by: "actor", object_path: "f/e1/panel.jpg" }, event: { id: "v1", event_kind: "uploaded" }, replayed: false } });
    const failed = { ...own, state: "failed", failure_reason: "checksum_mismatch" };
    const mismatch = evidenceResultReply({ evidence: failed, event: { ...event, event_kind: "failed" }, replayed: false, outcome: "checksum_mismatch" }, "actor", "uploaded");
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ outcome: "conflict", evidence_outcome: "checksum_mismatch", evidence: { id: "e1", state: "failed", failure_reason: "checksum_mismatch" }, replayed: false });
    expect(typeof mismatch.body.error).toBe("string");
    expect(mismatch.body.evidence).not.toHaveProperty("object_path");
    const changed = evidenceResultReply({ evidence: { ...failed, failure_reason: "object_changed" }, event: { ...event, event_kind: "failed" }, replayed: false, outcome: "object_changed", satisfaction: null }, "actor", "finalize");
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ outcome: "conflict", evidence_outcome: "object_changed", satisfaction: null });
    const unverifiable = evidenceResultReply({ evidence: { ...own, state: "uploaded", checksum_verified: false }, event, replayed: true, outcome: "checksum_unverifiable" }, "actor", "uploaded");
    expect(unverifiable.status).toBe(409);
    expect(unverifiable.body).toMatchObject({ outcome: "uncertain", evidence_outcome: "checksum_unverifiable", error: CHECKSUM_UNVERIFIABLE_WORDING, replayed: true, evidence: { object_path: "f/e1/panel.jpg" } });
    const finalized = evidenceResultReply({ evidence: { ...own, state: "finalized" }, event: { ...event, event_kind: "finalized" }, replayed: false, outcome: "finalized", satisfaction: { receipt_evidence_status: "complete" } }, "actor", "finalize");
    expect(finalized).toEqual({ status: 200, body: { outcome: "receipt", evidence_outcome: "finalized", evidence: { id: "e1", state: "finalized", uploaded_by: "actor" }, event: { id: "v1", event_kind: "finalized" }, replayed: false, satisfaction: { receipt_evidence_status: "complete" } } });
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
      "An expected receipt revision is required", "reason must be text of at most 2000 characters", "md5 is required for an object kind", "md5 must be 32 lowercase hex characters",
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

  it("treats a finalize refused for an unverifiable checksum as uncertain at 409, verbatim", () => {
    expect(mapEvidenceRpcError({ code: "P0001", message: CHECKSUM_UNVERIFIABLE_WORDING }, "finalize")).toEqual({ status: 409, outcome: "uncertain", error: CHECKSUM_UNVERIFIABLE_WORDING });
  });

  it("treats an unknown code as uncertain without echoing it", () => {
    const mapped = mapEvidenceRpcError({ code: "57014", message: "canceling statement due to statement timeout" }, "finalize");
    expect(mapped).toEqual({ status: 500, outcome: "uncertain", error: "Evidence finalization could not be confirmed; re-read the evidence before retrying" });
    expect(mapEvidenceRpcError({ code: "23503", message: "fk" }, "prepare")).toEqual({ status: 400, outcome: "validation", error: "Evidence preparation contains an invalid reference or value" });
  });
});
