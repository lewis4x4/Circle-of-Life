import { describe, expect, it } from "vitest";

import {
  facilityRequirementDraftPayloadSchema,
  mapRequirementRpcError,
  publicationBodySchema,
  requirementDraftPayloadSchema,
  saveRequirementDraftBodySchema,
} from "./requirements";

describe("requirement draft payload shaping", () => {
  it("accepts a complete central draft with typed inputs and evidence", () => {
    const parsed = requirementDraftPayloadSchema.safeParse({
      title: "Generator weekly observation",
      wording: "Observe the weekly generator test run and record run minutes.",
      subject_kind: "facility",
      allowed_recorder_roles: ["maintenance_role", "facility_admin"],
      review_required: true,
      allowed_reviewer_roles: ["facility_admin"],
      required_inputs: [{ key: "run_minutes", label: "Run minutes", type: "number", required: true, min: 0 }],
      required_evidence: [{ kind: "photo", label: "Panel photo", min_count: 1, when: "always" }],
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    [{ status: "published" }, "status is not an editable field"],
    [{ version: 9 }, "version cannot be chosen"],
    [{ published_by: "someone" }, "approver cannot be supplied"],
    [{ required_inputs: [{ key: "Bad Key", label: "x", type: "number", required: true }] }, "input keys are identifiers"],
    [{ required_inputs: [{ key: "temp", label: "Temp", type: "text", required: true, min: 1 }] }, "min applies to numbers only"],
    [{ required_inputs: [{ key: "pick", label: "Pick", type: "choice", required: true }] }, "choice needs choices"],
    [{ required_evidence: [{ kind: "video", label: "Clip", min_count: 1, when: "always" }] }, "unknown evidence kind"],
    [{ required_evidence: [{ kind: "photo", label: "Panel", min_count: 0, when: "always" }] }, "min_count must be at least one"],
    [{ subject_kind: "vendor" }, "unknown subject kind"],
    [{ required_inputs: [{ key: "a", label: "A", type: "number", required: true }, { key: "a", label: "B", type: "text", required: false }] }, "duplicate input keys"],
    [{ required_inputs: [{ key: "a", label: "A", type: "number", required: true, min: Number.POSITIVE_INFINITY }] }, "non-finite bound"],
    [{ allowed_recorder_roles: ["owner", "owner"] }, "duplicate roles"],
  ])("rejects %j (%s)", (payload) => {
    expect(requirementDraftPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps applicability, schedule status and override source explicit on site drafts", () => {
    expect(facilityRequirementDraftPayloadSchema.safeParse({ applicability: "maybe" }).success).toBe(false);
    expect(facilityRequirementDraftPayloadSchema.safeParse({ schedule_status: "confirmed", schedule_rule: null }).success).toBe(false);
    expect(facilityRequirementDraftPayloadSchema.safeParse({ schedule_status: "confirmed", schedule_rule: { kind: "weekly" } }).success).toBe(true);
    expect(facilityRequirementDraftPayloadSchema.safeParse({ local_required_evidence: [{ kind: "photo", label: "Panel", min_count: 1, when: "always" }, { kind: "document", label: "Panel", min_count: 1, when: "always" }] }).success).toBe(false);
    expect(facilityRequirementDraftPayloadSchema.safeParse({ override_source: "guess" }).success).toBe(false);
    expect(facilityRequirementDraftPayloadSchema.safeParse({ approved_by: "someone" }).success).toBe(false);
    expect(facilityRequirementDraftPayloadSchema.safeParse({ applicability: "not_applicable", applicability_reason: "No generator", override_source: "interview" }).success).toBe(true);
  });

  it("requires an activity identifier and an object payload for a central draft", () => {
    expect(saveRequirementDraftBodySchema.safeParse({ activity_id: "not-a-uuid", payload: {} }).success).toBe(false);
    expect(saveRequirementDraftBodySchema.safeParse({ activity_id: "11111111-1111-4111-8111-111111111111", payload: {} }).success).toBe(true);
  });

  it("requires an explicit effective time with an offset for publication", () => {
    expect(publicationBodySchema.safeParse({}).success).toBe(false);
    expect(publicationBodySchema.safeParse({ effective_from: "2026-10-01" }).success).toBe(false);
    expect(publicationBodySchema.safeParse({ effective_from: "2026-10-01T00:00:00-04:00" }).success).toBe(true);
    expect(publicationBodySchema.safeParse({ effective_from: "2026-10-01T04:00:00Z", extra: true }).success).toBe(false);
  });
});

describe("requirement database outcome mapping", () => {
  it("hides existence on authority denial", () => {
    expect(mapRequirementRpcError({ code: "42501", message: "Requirement draft unavailable for site 1234" })).toEqual({ status: 403, error: "Requirement unavailable" });
  });
  it("returns bounded validation messages and hides internal detail", () => {
    expect(mapRequirementRpcError({ code: "22023", message: "Requirement version is not publishable: requirement wording is required" }))
      .toEqual({ status: 409, error: "Requirement version is not publishable: requirement wording is required" });
    expect(mapRequirementRpcError({ code: "22023", message: "Requirement draft field is not editable" })).toEqual({ status: 400, error: "Requirement draft field is not editable" });
    expect(mapRequirementRpcError({ code: "22023", message: "Facility requirement draft contains an invalid value: a confirmed schedule requires a rule" }).status).toBe(400);
    expect(mapRequirementRpcError({ code: "23514", message: "Local recorder roles must be a subset of the central roles" }).status).toBe(409);
    expect(mapRequirementRpcError({ code: "23514", message: "new row for relation \"operation_facility_requirements\" violates check constraint \"secret_constraint\"" }))
      .toEqual({ status: 409, error: "Requirement request could not be completed. Review the current version and retry." });
  });
  it("treats bad references as client errors and everything else as generic failures", () => {
    expect(mapRequirementRpcError({ code: "22P02", message: "invalid input syntax for type uuid" }).status).toBe(400);
    expect(mapRequirementRpcError({ code: "XX000", message: "relation private_table does not exist" })).toEqual({ status: 500, error: "Requirement request could not be completed" });
  });
});
