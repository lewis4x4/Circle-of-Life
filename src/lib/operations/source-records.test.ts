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

// COL-159: service and dietary record bodies, the widened observation kinds and the new refusal wordings.
import {
  OBSERVATION_KINDS,
  SERVICE_KINDS,
  dietaryRecordCommandBodySchema,
  facilityServiceCommandBodySchema,
  isAssetServiceKind,
  listDietaryRecordsQuerySchema,
  listFacilityServicesQuerySchema,
  recordDietaryRecordBodySchema,
  recordFacilityServiceBodySchema,
} from "./source-records";

const vendor = "99999999-9999-4999-8999-999999999999";
const service = { facility_id: facility, service_kind: "extinguisher_inspection", asset_id: asset, performed_at: "2026-09-10T14:00:00-04:00", outcome: "pass" };

describe("COL-159 observation kinds", () => {
  it("accepts the two AED components as observation kinds", () => {
    expect(OBSERVATION_KINDS).toContain("aed_operation_check");
    expect(OBSERVATION_KINDS).toContain("aed_equipment_check");
    expect(recordAssetObservationBodySchema.safeParse({ request_key: key, payload: { ...observation, observation_kind: "aed_equipment_check" } }).success).toBe(true);
  });
});

describe("record facility service body", () => {
  it("accepts a staff service against an asset and a vendor service against the site, and refuses the composite shapes by name", () => {
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: service }).success).toBe(true);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, service_kind: "sprinkler_inspection", asset_id: undefined, performer_kind: "vendor", vendor_id: vendor, performer_label: "Technician", entry_reason: "Vendor visit", next_due_on: "2027-03-01", certificate_document_id: facility } }).success).toBe(true);
    const siteWithAsset = recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, service_kind: "fire_inspection" } });
    expect(siteWithAsset.success).toBe(false);
    expect(siteWithAsset.success ? "" : siteWithAsset.error.issues[0]?.message).toBe("fire_inspection is recorded against the site, not an asset");
    const assetWithout = recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, asset_id: undefined } });
    expect(assetWithout.success).toBe(false);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, performer_kind: "vendor" } }).success).toBe(false);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, performer_kind: "vendor", vendor_id: vendor, performed_by: asset } }).success).toBe(false);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, vendor_id: vendor } }).success).toBe(false);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, next_due_on: "soon" } }).success).toBe(false);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, service_kind: "elevator_inspection" } }).success).toBe(false);
    expect(recordFacilityServiceBodySchema.safeParse({ request_key: key, payload: { ...service, surprise: true } }).success).toBe(false);
    expect(SERVICE_KINDS.filter(isAssetServiceKind)).toEqual(["extinguisher_inspection", "hood_cleaning", "ac_filter_change"]);
  });

  it("requires an expected version and a reason for a correction, only a reason for a void, and never a kind", () => {
    expect(facilityServiceCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 2, payload: { reason: "Tag misread", readings: { tag_year: 2025 }, asset_id: asset, next_due_on: null } }).success).toBe(true);
    expect(facilityServiceCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 2, payload: { reason: "Kind", service_kind: "hood_cleaning" } }).success).toBe(false);
    expect(facilityServiceCommandBodySchema.safeParse({ request_key: key, action: "correct", payload: { reason: "x" } }).success).toBe(false);
    expect(facilityServiceCommandBodySchema.safeParse({ request_key: key, action: "void", payload: { reason: "Wrong unit" } }).success).toBe(true);
    expect(facilityServiceCommandBodySchema.safeParse({ request_key: key, action: "void", payload: {} }).success).toBe(false);
    expect(listFacilityServicesQuerySchema.safeParse({ facility_id: facility, kind: "hood_cleaning", asset_id: asset, voided: "false" }).success).toBe(true);
    expect(listFacilityServicesQuerySchema.safeParse({ facility_id: facility, kind: "drill" }).success).toBe(false);
  });
});

describe("record dietary record body", () => {
  const substitution = { facility_id: facility, record_kind: "meal_substitution", performed_at: "2026-09-10T12:10:00-04:00", service_date: "2026-09-10", meal_period: "lunch", planned_item: "Baked chicken", substitute_item: "Turkey loaf", substitution_reason: "Delivery short" };

  it("accepts each kind with its own fields and refuses the other kinds' fields, a failed substitution or approval, and a failed check without an issue", () => {
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: substitution }).success).toBe(true);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { ...substitution, meal_service_id: asset } }).success).toBe(true);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { facility_id: facility, record_kind: "menu_approval", performed_at: substitution.performed_at, menu_label: "Fall cycle", approver_label: "RD on file", approval_document_id: asset, entry_reason: "Late" } }).success).toBe(true);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { facility_id: facility, record_kind: "emergency_food_supply_check", performed_at: substitution.performed_at, outcome: "failed", issue_summary: "Two cases past date", readings: { cases_counted: 18 } } }).success).toBe(true);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { ...substitution, planned_item: undefined } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { ...substitution, menu_label: "x" } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { ...substitution, outcome: "failed", issue_summary: "x" } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { ...substitution, meal_period: "brunch" } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { facility_id: facility, record_kind: "menu_approval", performed_at: substitution.performed_at, menu_label: "Fall cycle" } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { facility_id: facility, record_kind: "emergency_food_supply_check", performed_at: substitution.performed_at, outcome: "failed" } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { facility_id: facility, record_kind: "emergency_food_supply_check", performed_at: substitution.performed_at, service_date: "2026-09-10" } }).success).toBe(false);
    expect(recordDietaryRecordBodySchema.safeParse({ request_key: key, payload: { ...substitution, resident_id: asset } }).success).toBe(false);
  });

  it("shapes corrections, voids and the list query", () => {
    expect(dietaryRecordCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 1, payload: { reason: "Item misnamed", substitute_item: "Turkey meatloaf", meal_service_id: null } }).success).toBe(true);
    expect(dietaryRecordCommandBodySchema.safeParse({ request_key: key, action: "correct", expected_version: 1, payload: { reason: "Kind", record_kind: "menu_approval" } }).success).toBe(false);
    expect(dietaryRecordCommandBodySchema.safeParse({ request_key: key, action: "void", payload: { reason: "Wrong shelf" } }).success).toBe(true);
    expect(listDietaryRecordsQuerySchema.safeParse({ facility_id: facility, kind: "menu_approval", voided: "true" }).success).toBe(true);
    expect(listDietaryRecordsQuerySchema.safeParse({ facility_id: facility, asset_id: asset }).success).toBe(false);
  });
});

describe("COL-159 error mapping", () => {
  it("classes the service and dietary refusals by name as validation and the record states as conflicts", () => {
    for (const message of [
      "A fire safety inspection is recorded against the site, not an asset",
      "An extinguisher inspection is recorded against a named asset",
      "Performer vendor is not linked to this site",
      "performed_by must be empty for a vendor performer",
      "A meal substitution is recorded on its service date",
      "A menu approval is recorded as performed; state a problem as an issue summary",
      "Service kind cannot change; void the record and record it again",
      "next_due_on must be after the service date",
      "Certificate is not a current document of this site",
      "Corrected record no longer matches the occurrence it satisfied; void the record and record it again",
    ]) {
      expect(mapReceiptRpcError({ code: "22023", message }, "source_record")).toEqual({ status: 400, outcome: "validation", error: message });
    }
    expect(mapReceiptRpcError({ code: "P0001", message: "Service record is voided" }, "source_record").outcome).toBe("conflict");
    expect(mapReceiptRpcError({ code: "P0001", message: "Dietary record is already voided" }, "source_record").outcome).toBe("conflict");
    expect(mapReceiptRpcError({ code: "23514", message: 'new row for relation "dietary_records" violates check constraint "dietary_records_kind_shape"' }, "source_record").error).toBe("Record request could not be completed. Refresh the occurrence and retry.");
  });
});
