import { describe, expect, it } from "vitest";

import { currentReceiptFields, mapReceiptRpcError } from "./receipts";
import {
  SOURCE_EVENT_PENDING_STATES,
  SOURCE_EVENT_STATES,
  currentEventRevision,
  deliverSourceEventBodySchema,
  isSourceDeliveryOutcome,
  listSourceEventsQuerySchema,
  presentSourceOutcome,
  reconcileSourceEventBodySchema,
} from "./source-links";

const facility = "33333333-3333-4333-8333-333333333333";
const occurrence = "55555555-5555-4555-8555-555555555555";
const key = "deliver:2026-09-10:0001";
const revision = "a".repeat(64);

describe("source delivery body", () => {
  it("accepts a final or voided record identity for one site", () => {
    const parsed = deliverSourceEventBodySchema.safeParse({ request_key: key, payload: { source_key: "drill-log", source_record_id: "D-2026-09-10:1", source_record_version: "3", event_kind: "voided", facility_id: facility } });
    expect(parsed.success).toBe(true);
  });

  it("refuses an unknown event kind, a non-slug source key, an unstable record id and extra fields", () => {
    expect(deliverSourceEventBodySchema.safeParse({ request_key: key, payload: { source_key: "drill-log", source_record_id: "1", source_record_version: "1", event_kind: "draft", facility_id: facility } }).success).toBe(false);
    expect(deliverSourceEventBodySchema.safeParse({ request_key: key, payload: { source_key: "Drill Log", source_record_id: "1", source_record_version: "1", event_kind: "final", facility_id: facility } }).success).toBe(false);
    expect(deliverSourceEventBodySchema.safeParse({ request_key: key, payload: { source_key: "drill-log", source_record_id: "a b", source_record_version: "1", event_kind: "final", facility_id: facility } }).success).toBe(false);
    expect(deliverSourceEventBodySchema.safeParse({ request_key: key, payload: { source_key: "drill-log", source_record_id: "1", source_record_version: "1", event_kind: "final", facility_id: facility, organization_id: facility } }).success).toBe(false);
    expect(deliverSourceEventBodySchema.safeParse({ request_key: "short", payload: { source_key: "drill-log", source_record_id: "1", source_record_version: "1", event_kind: "final", facility_id: facility } }).success).toBe(false);
  });
});

describe("reconcile body", () => {
  it("requires an occurrence for select, a reason for dismiss, and nothing extra for retry", () => {
    expect(reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: revision, payload: { action: "retry" } }).success).toBe(true);
    expect(reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: revision, payload: { action: "select", occurrence_id: occurrence } }).success).toBe(true);
    expect(reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: revision, payload: { action: "dismiss", reason: "Record predates the schedule" } }).success).toBe(true);
    const select = reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: revision, payload: { action: "select" } });
    expect(select.success).toBe(false);
    const dismiss = reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: revision, payload: { action: "dismiss" } });
    expect(dismiss.success).toBe(false);
    const retry = reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: revision, payload: { action: "retry", occurrence_id: occurrence } });
    expect(retry.success).toBe(false);
    expect(reconcileSourceEventBodySchema.safeParse({ request_key: key, expected_revision: "nope", payload: { action: "retry" } }).success).toBe(false);
  });
});

describe("list query", () => {
  it("needs a facility and accepts only known states and attention flags", () => {
    expect(listSourceEventsQuerySchema.safeParse({ facility_id: facility }).success).toBe(true);
    expect(listSourceEventsQuerySchema.safeParse({ facility_id: facility, attention: "false", state: "dismissed" }).success).toBe(true);
    expect(listSourceEventsQuerySchema.safeParse({ facility_id: facility, state: "pending" }).success).toBe(false);
    expect(listSourceEventsQuerySchema.safeParse({}).success).toBe(false);
    expect(SOURCE_EVENT_PENDING_STATES.every((state) => (SOURCE_EVENT_STATES as readonly string[]).includes(state))).toBe(true);
  });
});

describe("outcome guard and presentation", () => {
  const event = { id: "e1", state: "satisfied", attention: false, request_hash: "f".repeat(64), snapshot: { version: "1" } };
  it("recognises the delivery reply shape and strips idempotency material", () => {
    const value = { event, occurrence: { id: occurrence, status: "completed" }, receipt: { id: "r1", request_hash: "f".repeat(64) }, candidates: [occurrence], replayed: false };
    expect(isSourceDeliveryOutcome(value)).toBe(true);
    const presented = presentSourceOutcome(value);
    expect(presented.outcome).toBe("receipt");
    expect(presented.event).toEqual({ id: "e1", state: "satisfied", attention: false, snapshot: { version: "1" } });
    expect(presented.receipt).toEqual({ id: "r1" });
    expect(presented.candidates).toEqual([occurrence]);
  });

  it("refuses replies without a state, attention flag, candidate list or replay flag", () => {
    expect(isSourceDeliveryOutcome({ event: { id: "e1" }, occurrence: null, receipt: null, candidates: [], replayed: false })).toBe(false);
    expect(isSourceDeliveryOutcome({ event, occurrence: null, receipt: null, candidates: "none", replayed: false })).toBe(false);
    expect(isSourceDeliveryOutcome({ event, occurrence: null, receipt: null, candidates: [], replayed: "yes" })).toBe(false);
    expect(isSourceDeliveryOutcome({ event, occurrence: null, receipt: null, candidates: [], replayed: true })).toBe(true);
    expect(isSourceDeliveryOutcome(null)).toBe(false);
  });
});

describe("error mapping for the source commands", () => {
  it("returns a moved event revision as a conflict naming the current revision", () => {
    const mapped = mapReceiptRpcError({ code: "P0001", message: "Event changed since it was read", details: `current_event_revision=${revision}` }, "reconcile");
    expect(mapped).toMatchObject({ status: 409, outcome: "conflict", error: "Event changed since it was read", current_event_revision: revision });
    expect(currentReceiptFields(mapped)).toEqual({ current_event_revision: revision });
    expect(currentEventRevision({ details: `current_event_revision=${revision}` })).toBe(revision);
    expect(currentEventRevision({ details: "nothing" })).toBeUndefined();
  });

  it("never echoes Postgres constraint wording that names a 346 object for the existing commands", () => {
    const shape = mapReceiptRpcError({ code: "23514", message: 'new row for relation "operation_execution_receipts" violates check constraint "operation_receipt_source_shape"' }, "record");
    expect(shape).toEqual({ status: 409, outcome: "conflict", error: "Record request could not be completed. Refresh the occurrence and retry." });
    const unique = mapReceiptRpcError({ code: "23505", message: 'duplicate key value violates unique constraint "operation_source_events_request_key_key"' }, "deliver");
    expect(unique).toEqual({ status: 409, outcome: "conflict", error: "Source delivery conflicts with an existing delivery" });
    const org = mapReceiptRpcError({ code: "23514", message: 'violates check constraint "operation_execution_receipts_organization_id_check"' }, "correct");
    expect(org.error).not.toContain("organization_id");
    const kind = mapReceiptRpcError({ code: "23514", message: 'violates check constraint "operation_source_events_event_kind_check"' }, "verify");
    expect(kind.error).not.toContain("event_kind");
  });

  it("classes a settled row and different replay content as conflicts, allowlist and shape refusals as validation, and denial as hidden", () => {
    expect(mapReceiptRpcError({ code: "P0001", message: "Source delivery is settled" }, "reconcile")).toMatchObject({ status: 409, outcome: "conflict" });
    expect(mapReceiptRpcError({ code: "P0001", message: "This request was already saved with different content" }, "deliver")).toMatchObject({ status: 409, outcome: "conflict" });
    expect(mapReceiptRpcError({ code: "22023", message: "Source adapter is not allowlisted" }, "deliver")).toEqual({ status: 400, outcome: "validation", error: "Source adapter is not allowlisted" });
    expect(mapReceiptRpcError({ code: "22023", message: "Selected occurrence is not a candidate for this source record" }, "reconcile")).toEqual({ status: 400, outcome: "validation", error: "Selected occurrence is not a candidate for this source record" });
    expect(mapReceiptRpcError({ code: "22023", message: "event_kind must be final or voided" }, "deliver")).toEqual({ status: 400, outcome: "validation", error: "event_kind must be final or voided" });
    expect(mapReceiptRpcError({ code: "42501", message: "Operation unavailable" }, "deliver")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapReceiptRpcError({ code: "XX000", message: "something internal" }, "deliver")).toEqual({ status: 500, outcome: "uncertain", error: "Source delivery could not be confirmed; check the occurrence before retrying" });
    expect(mapReceiptRpcError({ code: "22023", message: "internal detail the operator must not see" }, "reconcile")).toEqual({ status: 400, outcome: "validation", error: "Reconcile request contains an invalid value" });
  });
});
