import { describe, expect, it } from "vitest";

import {
  associateOccurrenceBodySchema,
  cancelOccurrenceBodySchema,
  enrollBindingBodySchema,
  isBindingRecord,
  isCommandReceipt,
  isOccurrenceRecord,
  manualOccurrenceBodySchema,
  mapOccurrenceRpcError,
  requestKeySchema,
} from "./occurrences";

const uuid = "11111111-1111-4111-8111-111111111111";
const revision = "a".repeat(64);

describe("occurrence cancellation conflicts", () => {
  it("surfaces recorded work as a plain conflict rather than a hidden state", () => {
    expect(mapOccurrenceRpcError({ code: "P0001", message: "Occurrence has recorded work" })).toEqual({ status: 409, error: "Occurrence has recorded work" });
    expect(mapOccurrenceRpcError({ code: "P0001", message: "Occurrence has an open issue" })).toEqual({ status: 409, error: "Occurrence has an open issue" });
  });
});

describe("occurrence request shapes", () => {
  it("accepts a complete binding enrolment and refuses server-owned or unknown fields", () => {
    const body = { activity_id: uuid, facility_id: uuid, subject_id: uuid, authority_class: "asset", shift: null, provenance: { source: "interview", reason: "Two generators on site" }, effective_from: "2026-10-01T04:00:00Z" };
    expect(enrollBindingBodySchema.safeParse(body).success).toBe(true);
    expect(enrollBindingBodySchema.safeParse({ ...body, created_by: uuid }).success).toBe(false);
    expect(enrollBindingBodySchema.safeParse({ ...body, authority_class: "unclassified" }).success).toBe(false);
    expect(enrollBindingBodySchema.safeParse({ ...body, provenance: { source: "interview", reason: " " } }).success).toBe(false);
  });

  it("keeps the manual payload to a queue date, a shift and a note", () => {
    const body = { activity_id: uuid, facility_id: uuid, subject_id: uuid, request_key: "manual:2026-09-10:0001", payload: { queue_date: "2026-09-10", note: "Found during rounds" } };
    expect(manualOccurrenceBodySchema.safeParse(body).success).toBe(true);
    expect(manualOccurrenceBodySchema.safeParse({ ...body, payload: { due_at: "2026-09-10T10:00:00Z" } }).success).toBe(false);
    expect(manualOccurrenceBodySchema.safeParse({ ...body, payload: { queue_date: "10/09/2026" } }).success).toBe(false);
  });

  it("requires the occurrence revision and an explicit association kind", () => {
    const body = { work_task_id: uuid, association_kind: "late", expected_revision: revision, reason: "Completed the next morning", request_key: "assoc-0001" };
    expect(associateOccurrenceBodySchema.safeParse(body).success).toBe(true);
    expect(associateOccurrenceBodySchema.safeParse({ ...body, association_kind: "same" }).success).toBe(false);
    expect(associateOccurrenceBodySchema.safeParse({ ...body, expected_revision: "latest" }).success).toBe(false);
    expect(cancelOccurrenceBodySchema.safeParse({ reason: "Resident discharged", request_key: "cancel-0001" }).success).toBe(true);
    expect(cancelOccurrenceBodySchema.safeParse({ reason: "", request_key: "cancel-0001" }).success).toBe(false);
  });

  it("bounds request keys to key characters of a useful length", () => {
    expect(requestKeySchema.safeParse("short").success).toBe(false);
    expect(requestKeySchema.safeParse("has spaces in it").success).toBe(false);
    expect(requestKeySchema.safeParse("6f1c2d3e-0000-4000-8000-000000000000").success).toBe(true);
  });
});

describe("occurrence database outcomes", () => {
  it("hides existence on authority denial", () => {
    expect(mapOccurrenceRpcError({ code: "42501", message: "Operation unavailable" })).toEqual({ status: 403, error: "Operation unavailable" });
  });

  it("reports idempotency and state conflicts with their bounded message", () => {
    expect(mapOccurrenceRpcError({ code: "P0001", message: "This request was already saved with different content" })).toEqual({ status: 409, error: "This request was already saved with different content" });
    expect(mapOccurrenceRpcError({ code: "P0001", message: "Occurrence changed since it was read" })).toEqual({ status: 409, error: "Occurrence changed since it was read" });
    expect(mapOccurrenceRpcError({ code: "23505", message: "Work is already associated" })).toEqual({ status: 409, error: "Work is already associated" });
    expect(mapOccurrenceRpcError({ code: "P0001", message: "Managed occurrences cannot be deferred by the legacy command" }).status).toBe(409);
  });

  it("treats request-shape rejections as client errors and everything else as generic", () => {
    expect(mapOccurrenceRpcError({ code: "22023", message: "Manual occurrence payload must be an object" })).toEqual({ status: 400, error: "Manual occurrence payload must be an object" });
    expect(mapOccurrenceRpcError({ code: "22023", message: "internal detail with a table name" })).toEqual({ status: 400, error: "Occurrence request contains an invalid value" });
    expect(mapOccurrenceRpcError({ code: "P0001", message: "internal detail" })).toEqual({ status: 409, error: "Occurrence request could not be completed. Refresh and retry." });
    expect(mapOccurrenceRpcError({ code: "23503", message: "fk" }).status).toBe(400);
    expect(mapOccurrenceRpcError({ code: "XX000", message: "boom" })).toEqual({ status: 500, error: "Occurrence request could not be completed" });
  });

  it("recognises records and receipts", () => {
    expect(isOccurrenceRecord({ id: uuid })).toBe(true);
    expect(isOccurrenceRecord({ status: "pending" })).toBe(false);
    expect(isBindingRecord({ id: uuid, effective_from: "2026-10-01T04:00:00Z" })).toBe(true);
    expect(isBindingRecord({ id: uuid })).toBe(false);
    expect(isCommandReceipt({ replayed: false, association_id: uuid })).toBe(true);
    expect(isCommandReceipt(null)).toBe(false);
  });
});
