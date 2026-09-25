import { describe, expect, it } from "vitest";

import {
  PRESENCE_OPTIONS,
  isPresenceStatus,
  lifecycleStatusLabel,
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
    expect(presenceLabel("hospital")).toBe("Bed Hold — Hospital or rehab");
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

  it("isPresenceStatus is true only for the three editable presence states", () => {
    expect(isPresenceStatus("active")).toBe(true);
    expect(isPresenceStatus("hospital_hold")).toBe(true);
    expect(isPresenceStatus("loa")).toBe(true);
  });

  it("isPresenceStatus is false for lifecycle-terminal / pre-admission states (guards the editable control)", () => {
    // These must NOT render the editable presence control — otherwise a
    // discharged/deceased resident shows as "In-house" and a click could
    // resurrect them into a billable presence state.
    for (const raw of ["inquiry", "pending_admission", "discharged", "deceased", "", null]) {
      expect(isPresenceStatus(raw)).toBe(false);
    }
  });

  it("lifecycleStatusLabel gives a read-only label for non-presence statuses", () => {
    expect(lifecycleStatusLabel("discharged")).toBe("Discharged");
    expect(lifecycleStatusLabel("deceased")).toBe("Deceased");
    expect(lifecycleStatusLabel("pending_admission")).toBe("Pending admission");
    expect(lifecycleStatusLabel("inquiry")).toBe("Inquiry");
    expect(lifecycleStatusLabel(null)).toBe("Status unknown");
  });
});

describe("hospital and rehab (COL-755)", () => {
  it("names a bed hold by its recorded type and never guesses an unrecorded one", async () => {
    const { bedHoldLabel, presenceLabel: label } = await import("./presence");
    expect(bedHoldLabel("hospital")).toBe("Bed Hold — Hospital");
    expect(bedHoldLabel("rehab")).toBe("Bed Hold — Rehab");
    expect(bedHoldLabel(null)).toBe("Bed Hold — Hospital or rehab (type not recorded)");
    expect(label("hospital", "rehab")).toBe("Bed Hold — Rehab");
    expect(label("active", null)).toBe("In-house");
  });

  it("offers hospital and rehab as two choices of the one bed-hold status", async () => {
    const { PRESENCE_CHOICES } = await import("./presence");
    expect(PRESENCE_CHOICES.map((choice) => [choice.key, choice.dbValue, choice.stayType])).toEqual([
      ["active", "active", undefined],
      ["hospital", "hospital_hold", "hospital"],
      ["rehab", "hospital_hold", "rehab"],
      ["loa", "loa", undefined],
    ]);
  });

  it("dates hospital to rehab as a movement, and naming an unrecorded stay as a correction", async () => {
    const { presenceChange } = await import("./presence");
    expect(presenceChange("hospital", "hospital", "rehab")).toBe("movement");
    expect(presenceChange("hospital", null, "rehab")).toBe("record_type");
    expect(presenceChange("hospital", null, "active")).toBe("movement");
    expect(presenceChange("active", undefined, "hospital")).toBe("movement");
    expect(presenceChange("hospital", "rehab", "rehab")).toBe("none");
  });
});
