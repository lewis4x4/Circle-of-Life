import { describe, expect, it } from "vitest";

import {
  PRESENCE_OPTIONS,
  mapResidencyStatus,
  presenceLabel,
  presenceTone,
  residencyStatusToDbValue,
} from "./presence";

describe("resident presence vocabulary", () => {
  it("maps resident_status enum values to UI presence values", () => {
    expect(mapResidencyStatus("active")).toBe("active");
    expect(mapResidencyStatus("hospital_hold")).toBe("hospital");
    expect(mapResidencyStatus("loa")).toBe("loa");
  });

  it("projects non-presence / unknown lifecycle values onto in-house so the UI never crashes", () => {
    expect(mapResidencyStatus("inquiry")).toBe("active");
    expect(mapResidencyStatus("discharged")).toBe("active");
    expect(mapResidencyStatus("deceased")).toBe("active");
    expect(mapResidencyStatus(null)).toBe("active");
  });

  it("round-trips UI presence -> resident_status enum value for the write path", () => {
    expect(residencyStatusToDbValue("active")).toBe("active");
    expect(residencyStatusToDbValue("hospital")).toBe("hospital_hold");
    expect(residencyStatusToDbValue("loa")).toBe("loa");
  });

  it("exposes the owner-approved COL labels (HANDOFF_v2 Option A relabel)", () => {
    expect(presenceLabel("active")).toBe("In-house");
    expect(presenceLabel("hospital")).toBe("Bed Hold — Hospital");
    expect(presenceLabel("loa")).toBe("On leave / vacation");
  });

  it("assigns quiet-operator tones (in-house muted, hospital danger, leave warning)", () => {
    expect(presenceTone("active")).toBe("muted");
    expect(presenceTone("hospital")).toBe("danger");
    expect(presenceTone("loa")).toBe("warning");
  });

  it("offers exactly the three in-census presence states, in-house first", () => {
    expect(PRESENCE_OPTIONS.map((o) => o.status)).toEqual(["active", "hospital", "loa"]);
    expect(PRESENCE_OPTIONS.map((o) => o.dbValue)).toEqual(["active", "hospital_hold", "loa"]);
  });
});
