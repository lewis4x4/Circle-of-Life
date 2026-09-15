import { describe, expect, it } from "vitest";

import {
  MEDICATION_SYSTEM_NOT_SET_COPY,
  formatMedicationOrdersAttachment,
  formatMedicationSystemOfRecord,
  medicationSystemOfRecordFromSettings,
} from "./medication-system-of-record";

describe("medicationSystemOfRecordFromSettings", () => {
  it("reads a known system and knows whether it is external", () => {
    expect(medicationSystemOfRecordFromSettings({ medication_system_of_record: "quickmar" })).toEqual({ key: "quickmar", label: "QuickMAR (PointClickCare)", external: true });
    expect(medicationSystemOfRecordFromSettings({ medication_system_of_record: "haven_emar" })).toEqual({ key: "haven_emar", label: "Haven eMAR", external: false });
  });

  it("uses the custom label only for another system, and only when posted", () => {
    expect(medicationSystemOfRecordFromSettings({ medication_system_of_record: "other", medication_system_label: " MatrixCare " })?.label).toBe("MatrixCare");
    expect(medicationSystemOfRecordFromSettings({ medication_system_of_record: "other" })?.label).toBe("Another system");
    expect(medicationSystemOfRecordFromSettings({ medication_system_of_record: "quickmar", medication_system_label: "Ignored" })?.label).toBe("QuickMAR (PointClickCare)");
  });

  it("reads anything malformed as not set rather than defaulting", () => {
    expect(medicationSystemOfRecordFromSettings(null)).toBeNull();
    expect(medicationSystemOfRecordFromSettings({})).toBeNull();
    expect(medicationSystemOfRecordFromSettings({ medication_system_of_record: "emar" })).toBeNull();
    expect(medicationSystemOfRecordFromSettings([])).toBeNull();
  });
});

describe("copy", () => {
  it("names the system or says it is not set, and asks for an attachment only when orders live elsewhere", () => {
    const quickmar = medicationSystemOfRecordFromSettings({ medication_system_of_record: "quickmar" });
    expect(formatMedicationSystemOfRecord(quickmar)).toBe("Orders of record: QuickMAR (PointClickCare)");
    expect(formatMedicationSystemOfRecord(null)).toBe(MEDICATION_SYSTEM_NOT_SET_COPY);
    expect(formatMedicationOrdersAttachment(quickmar)).toBe("Attach the current orders printout from QuickMAR (PointClickCare).");
    expect(formatMedicationOrdersAttachment(medicationSystemOfRecordFromSettings({ medication_system_of_record: "haven_emar" }))).toBeNull();
    expect(formatMedicationOrdersAttachment(null)).toBeNull();
  });
});
