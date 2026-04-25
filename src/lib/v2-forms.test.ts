import { describe, expect, it } from "vitest";

import {
  V2_FORM_IDS,
  isV2FormId,
  newAdmissionFormSchema,
  newIncidentFormSchema,
  newResidentFormSchema,
} from "./v2-forms";

// Real-shape UUIDs (v4 — third hex group starts with 4, fourth with 8/9/a/b).
const FAC = "550e8400-e29b-41d4-a716-446655440000";
const RES = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

describe("V2 form id narrowing", () => {
  it("exposes the three S10 forms", () => {
    expect(V2_FORM_IDS).toEqual(["new-resident", "new-admission", "new-incident"]);
  });

  it("isV2FormId narrows correctly", () => {
    expect(isV2FormId("new-resident")).toBe(true);
    expect(isV2FormId("new-admission")).toBe(true);
    expect(isV2FormId("new-incident")).toBe(true);
    expect(isV2FormId("nope")).toBe(false);
  });
});

describe("newResidentFormSchema", () => {
  it("accepts a fully-populated payload", () => {
    const result = newResidentFormSchema.safeParse({
      firstName: "Aria",
      lastName: "Smith",
      facilityId: FAC,
      dateOfBirth: "1948-03-12",
      primaryDiagnosis: "Heart failure",
      notes: "First admit cycle",
    });
    expect(result.success).toBe(true);
  });

  it("requires first/last name and a uuid facility", () => {
    const result = newResidentFormSchema.safeParse({
      firstName: "",
      lastName: "",
      facilityId: "not-a-uuid",
      dateOfBirth: "1948-03-12",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed dates", () => {
    const result = newResidentFormSchema.safeParse({
      firstName: "A",
      lastName: "S",
      facilityId: FAC,
      dateOfBirth: "1/12/1948",
    });
    expect(result.success).toBe(false);
  });
});

describe("newAdmissionFormSchema", () => {
  it("requires both resident and facility uuids", () => {
    const ok = newAdmissionFormSchema.safeParse({
      residentId: RES,
      facilityId: FAC,
      targetMoveInDate: "2026-05-01",
    });
    expect(ok.success).toBe(true);

    const bad = newAdmissionFormSchema.safeParse({
      residentId: "",
      facilityId: FAC,
      targetMoveInDate: "2026-05-01",
    });
    expect(bad.success).toBe(false);
  });
});

describe("newIncidentFormSchema", () => {
  const minimal = {
    facilityId: FAC,
    residentId: RES,
    category: "fall",
    severity: "medium" as const,
    occurredAt: "2026-04-24T15:42",
    locationDescription: "Hallway A",
    description: "Resident fell while walking to the dining area.",
    injuryOccurred: true,
    ahcaReportable: false,
  };

  it("accepts the minimal payload", () => {
    expect(newIncidentFormSchema.safeParse(minimal).success).toBe(true);
  });

  it("requires a 10+ character description", () => {
    const result = newIncidentFormSchema.safeParse({ ...minimal, description: "short" });
    expect(result.success).toBe(false);
  });

  it("only accepts the four severity literals", () => {
    expect(
      newIncidentFormSchema.safeParse({ ...minimal, severity: "minor" as never }).success,
    ).toBe(false);
  });

  it("requires occurredAt in YYYY-MM-DDTHH:mm format", () => {
    expect(
      newIncidentFormSchema.safeParse({ ...minimal, occurredAt: "yesterday" }).success,
    ).toBe(false);
  });

  it("treats residentId as optional (resident-agnostic incidents allowed)", () => {
    expect(
      newIncidentFormSchema.safeParse({ ...minimal, residentId: "" }).success,
    ).toBe(true);
  });
});
