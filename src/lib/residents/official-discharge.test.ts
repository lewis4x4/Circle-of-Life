import { describe, expect, it } from "vitest";
import {
  DISCHARGE_REASONS,
  dischargeReasonLabel,
  dischargeStatusForReason,
  isAlreadyDischarged,
  officialDischargePatch,
  officialDischargeReceipt,
  validateOfficialDischarge,
} from "./official-discharge";

describe("official discharge", () => {
  it("records a death as deceased and everything else as discharged", () => {
    expect(dischargeStatusForReason("death")).toBe("deceased");
    for (const reason of DISCHARGE_REASONS.filter((r) => r !== "death")) {
      expect(dischargeStatusForReason(reason)).toBe("discharged");
    }
  });

  it("frees the bed on every reason, because the trigger keys off status and bed_id", () => {
    // haven.resident_status_holds_bed() holds a bed for active/hospital_hold/loa
    // and releases it for discharged/deceased (migration 388). Clearing bed_id
    // and writing a released status are the two halves; neither is optional.
    for (const reason of DISCHARGE_REASONS) {
      const patch = officialDischargePatch({ reason, date: "2026-09-15", actorId: "u" });
      expect(patch.bed_id).toBeNull();
      expect(["discharged", "deceased"]).toContain(patch.status);
    }
  });

  it("writes the reason, date and actor, and normalises an empty destination to null", () => {
    const patch = officialDischargePatch({
      reason: "home",
      date: "2026-09-15",
      destination: "  Daughter's home  ",
      actorId: "actor-1",
      now: new Date("2026-09-16T02:00:00Z"),
    });
    expect(patch).toEqual({
      status: "discharged",
      discharge_date: "2026-09-15",
      discharge_reason: "home",
      discharge_destination: "Daughter's home",
      bed_id: null,
      updated_at: "2026-09-16T02:00:00.000Z",
      updated_by: "actor-1",
    });
    expect(officialDischargePatch({ reason: "home", date: "2026-09-15", destination: "   ", actorId: null }).discharge_destination).toBeNull();
    expect(officialDischargePatch({ reason: "home", date: "2026-09-15", actorId: null }).discharge_destination).toBeNull();
  });

  it("asks for the date and the reason, and never supplies either itself", () => {
    // The date is the billing cutoff. A pre-filled today would be the form
    // choosing a billing date on the administrator's behalf.
    expect(validateOfficialDischarge({ date: "", reason: "" })).toEqual([
      "Choose the date belongings were removed.",
      "Choose the discharge reason.",
    ]);
    expect(validateOfficialDischarge({ date: "2026-09-15", reason: "" })).toEqual([
      "Choose the discharge reason.",
    ]);
    expect(validateOfficialDischarge({ date: "yesterday", reason: "home" })).toEqual([
      "Enter the discharge date as a calendar date.",
    ]);
    expect(validateOfficialDischarge({ date: "2026-09-15", reason: "home" })).toEqual([]);
  });

  it("knows a residency that has already ended", () => {
    expect(isAlreadyDischarged("discharged")).toBe(true);
    expect(isAlreadyDischarged("deceased")).toBe(true);
    for (const status of ["active", "hospital_hold", "loa", null, undefined]) {
      expect(isAlreadyDischarged(status)).toBe(false);
    }
  });

  it("says what actually happened, without operator-facing enum values", () => {
    expect(officialDischargeReceipt("death")).toBe("Recorded. The resident is off census and the bed is released.");
    expect(officialDischargeReceipt("home")).toContain("the bed is released");
    expect(officialDischargeReceipt("home")).toContain("billing stops on this date");
    expect(dischargeReasonLabel("higher_level_of_care")).toBe("Higher level of care");
    expect(dischargeReasonLabel("another_alf")).toBe("Another ALF");
    for (const reason of DISCHARGE_REASONS) expect(dischargeReasonLabel(reason)).not.toContain("_");
  });
});
