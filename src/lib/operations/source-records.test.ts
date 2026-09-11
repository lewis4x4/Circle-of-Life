import { describe, expect, it } from "vitest";

import { currentReceiptFields, mapReceiptRpcError } from "./receipts";
import {
  assetObservationCommandBodySchema,
  currentRecordVersion,
  drillLogCommandBodySchema,
  isSourceRecordOutcome,
  listAssetObservationsQuerySchema,
  presentSourceRecordOutcome,
  recordAssetObservationBodySchema,
} from "./source-records";

const facility = "33333333-3333-4333-8333-333333333333";
const asset = "44444444-4444-4444-8444-444444444444";
const key = "obs:2026-09-10:0001";
const observation = { facility_id: facility, asset_id: asset, observation_kind: "generator_test", basis: "staff_observed", observed_at: "2026-09-10T14:00:00-04:00", outcome: "pass", readings: { started_ok: true, run_minutes: 30 } };

describe("record observation body", () => {
  it("accepts a staff-observed observation with typed readings and passes the refused bases through for the database to name", () => {
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: observation }).success).toBe(true);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, basis: "automatic_self_test" } }).success).toBe(true);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, basis: "photo_only" } }).success).toBe(true);
  });

  it("refuses an unknown kind, an unknown basis, a non-instant, badly keyed or nested readings, a long key and extra fields", () => {
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, observation_kind: "sniff_test" } }).success).toBe(false);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, basis: "vendor_certificate" } }).success).toBe(false);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, observed_at: "yesterday" } }).success).toBe(false);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, readings: { "Bad Key": 1 } } }).success).toBe(false);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, readings: { nested: { a: 1 } } } }).success).toBe(false);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: `k${"x".repeat(120)}`, payload: observation }).success).toBe(false);
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, surprise: true } }).success).toBe(false);
  });
});

describe("observation and drill command bodies", () => {
  it("requires an expected version and a reason for a correction and only a reason for a void", () => {
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 2, payload: { reason: "Run time misread", readings: { run_minutes: 32 } } }).success).toBe(true);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "correct", payload: { reason: "Run time misread" } }).success).toBe(false);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 0, payload: { reason: "x" } }).success).toBe(false);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 1, payload: { readings: { run_minutes: 32 } } }).success).toBe(false);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "void", payload: { reason: "Wrong week" } }).success).toBe(true);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "void", payload: {} }).success).toBe(false);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "void", expected_version: 1, payload: { reason: "x" } }).success).toBe(false);
    expect(assetObservationCommandBodySchema.safeParse({ request_key: key, action: "finalize", payload: {} }).success).toBe(false);
  });

  it("accepts finalize with or without an entry reason, correct with drill fields, void with a reason", () => {
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "finalize", payload: {} }).success).toBe(true);
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "finalize", payload: { entry_reason: "Logged after the debrief" } }).success).toBe(true);
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "finalize", payload: { notes: "x" } }).success).toBe(false);
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 3, payload: { reason: "Count corrected", residents_present_count: 21, drill_date: "2026-09-10", drill_time: "14:00" } }).success).toBe(true);
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 3, payload: { reason: "Bad", drill_date: "not-a-date" } }).success).toBe(false);
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 3, payload: { reason: "Bad", drill_type: "earthquake" } }).success).toBe(false);
    expect(drillLogCommandBodySchema.safeParse({ request_key: key, action: "void", payload: { reason: "False alarm response" } }).success).toBe(true);
  });
});

describe("list query", () => {
  it("requires a site and accepts asset, kind and voided filters only", () => {
    expect(listAssetObservationsQuerySchema.safeParse({ facility_id: facility }).success).toBe(true);
    expect(listAssetObservationsQuerySchema.safeParse({ facility_id: facility, asset_id: asset, kind: "carbon_monoxide_check", voided: "false" }).success).toBe(true);
    expect(listAssetObservationsQuerySchema.safeParse({}).success).toBe(false);
    expect(listAssetObservationsQuerySchema.safeParse({ facility_id: facility, kind: "sniff_test" }).success).toBe(false);
    expect(listAssetObservationsQuerySchema.safeParse({ facility_id: facility, state: "final" }).success).toBe(false);
  });
});

describe("command outcome", () => {
  const delivery = {
    event: { id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false, request_hash: "f".repeat(64) },
    occurrence: { id: "55555555-5555-4555-8555-555555555555", status: "completed" },
    receipt: { id: "77777777-7777-4777-8777-777777777777", request_hash: "f".repeat(64), completion_state: "completed" },
    candidates: ["55555555-5555-4555-8555-555555555555"],
    replayed: false,
  };
  const record = { id: "88888888-8888-4888-8888-888888888888", record_version: 1, finalized_at: "2026-09-10T18:05:00Z" };

  it("recognises a linked reply, an undelivered tornado reply and refuses a reply without a record or verdict", () => {
    expect(isSourceRecordOutcome({ record, delivery, linked: true, replayed: false })).toBe(true);
    expect(isSourceRecordOutcome({ record, delivery: null, linked: false, replayed: false, link_reason: "no_checklist_activity" })).toBe(true);
    expect(isSourceRecordOutcome({ record, delivery: { event: { id: "x" } }, linked: true, replayed: false })).toBe(false);
    expect(isSourceRecordOutcome({ delivery, linked: true, replayed: false })).toBe(false);
    expect(isSourceRecordOutcome({ record, delivery, replayed: false })).toBe(false);
  });

  it("strips idempotency material from the delivery and keeps the link verdict", () => {
    const presented = presentSourceRecordOutcome({ record, delivery, linked: true, replayed: false });
    expect(presented.outcome).toBe("record");
    expect(presented.delivery?.event).toEqual({ id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false });
    expect(presented.delivery?.receipt).toEqual({ id: "77777777-7777-4777-8777-777777777777", completion_state: "completed" });
    expect(presented.linked).toBe(true);
    expect("link_reason" in presented).toBe(false);
    const tornado = presentSourceRecordOutcome({ record, delivery: null, linked: false, replayed: true, link_reason: "no_checklist_activity" });
    expect(tornado).toEqual({ outcome: "record", record, delivery: null, linked: false, replayed: true, link_reason: "no_checklist_activity" });
  });
});

describe("error mapping", () => {
  it("names a stale record version as a conflict carrying the current one", () => {
    const mapped = mapReceiptRpcError({ code: "P0001", message: "Record changed since it was read", details: "current_record_version=3" }, "source_record");
    expect(mapped).toEqual({ status: 409, outcome: "conflict", error: "Record changed since it was read", current_record_version: "3" });
    expect(currentReceiptFields(mapped)).toEqual({ current_record_version: "3" });
    expect(currentRecordVersion({ details: "current_record_version=3" })).toBe(3);
    expect(currentRecordVersion({ message: "nothing" })).toBeUndefined();
  });

  it("classes the refusals by name as validation and the record states as conflicts", () => {
    expect(mapReceiptRpcError({ code: "22023", message: "An automatic self-test is not a staff observation; record only what a staff member observed" }, "source_record")).toEqual({ status: 400, outcome: "validation", error: "An automatic self-test is not a staff observation; record only what a staff member observed" });
    expect(mapReceiptRpcError({ code: "22023", message: "A photo alone is not a staff observation; record only what a staff member observed" }, "source_record").outcome).toBe("validation");
    expect(mapReceiptRpcError({ code: "22023", message: "A generator test is recorded against a generator" }, "source_record").error).toBe("A generator test is recorded against a generator");
    expect(mapReceiptRpcError({ code: "22023", message: "Work performed earlier than fifteen minutes ago must be entered as late with a reason" }, "source_record").outcome).toBe("validation");
    expect(mapReceiptRpcError({ code: "22023", message: "A correction must restate at least one field" }, "source_record").error).toBe("A correction must restate at least one field");
    expect(mapReceiptRpcError({ code: "P0001", message: "Drill log is already final" }, "source_record")).toEqual({ status: 409, outcome: "conflict", error: "Drill log is already final" });
    expect(mapReceiptRpcError({ code: "P0001", message: "Observation is voided" }, "source_record").outcome).toBe("conflict");
    expect(mapReceiptRpcError({ code: "P0001", message: "Drill log is a draft; corrections apply to final logs" }, "source_record").outcome).toBe("conflict");
    expect(mapReceiptRpcError({ code: "42501", message: "Operation unavailable" }, "source_record")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    // An unknown wording is never echoed.
    expect(mapReceiptRpcError({ code: "23514", message: 'new row for relation "asset_observations" violates check constraint' }, "source_record").error).toBe("Record request could not be completed. Refresh the occurrence and retry.");
  });
});
