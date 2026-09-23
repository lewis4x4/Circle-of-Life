import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_MEDICATION_ERROR_FORM,
  MEDICATION_ERROR_SEVERITY_OPTIONS,
  MEDICATION_ERROR_SHIFT_OPTIONS,
  MEDICATION_ERROR_TYPE_OPTIONS,
  buildMedicationErrorInsert,
  missingMedicationErrorFields,
  type MedicationErrorFormState,
} from "./medication-error-form";

const RESIDENT_ID = "00000000-0000-4000-8000-000000000001";
const CONTEXT = {
  facilityId: "00000000-0000-4000-8000-0000000000f1",
  organizationId: "00000000-0000-4000-8000-0000000000a1",
  userId: "00000000-0000-4000-8000-0000000000b1",
  now: new Date("2026-09-22T12:00:00.000Z"),
};

const COMPLETE: MedicationErrorFormState = {
  ...EMPTY_MEDICATION_ERROR_FORM,
  residentId: RESIDENT_ID,
  errorType: "wrong_dose",
  severity: "no_harm",
  shift: "evening",
  description: "  Dose given twice  ",
  immediateActions: " Vitals checked ",
};

describe("medication error form", () => {
  it("starts with no classification pre-selected", () => {
    expect(EMPTY_MEDICATION_ERROR_FORM.residentId).toBe("");
    expect(EMPTY_MEDICATION_ERROR_FORM.errorType).toBe("");
    expect(EMPTY_MEDICATION_ERROR_FORM.severity).toBe("");
    expect(EMPTY_MEDICATION_ERROR_FORM.shift).toBe("");
    expect(missingMedicationErrorFields(EMPTY_MEDICATION_ERROR_FORM)).toEqual([
      "Resident",
      "Error type",
      "Outcome",
      "Shift",
      "What happened",
      "Immediate actions",
    ]);
  });

  it("labels every option in human text, never the raw enum", () => {
    for (const option of [
      ...MEDICATION_ERROR_TYPE_OPTIONS,
      ...MEDICATION_ERROR_SEVERITY_OPTIONS,
      ...MEDICATION_ERROR_SHIFT_OPTIONS,
    ]) {
      expect(option.label).not.toContain("_");
      expect(option.label[0]).toBe(option.label[0]?.toUpperCase());
    }
  });

  it("refuses to build a record with a missing classification", () => {
    expect(() => buildMedicationErrorInsert({ ...COMPLETE, severity: "" }, CONTEXT)).toThrow(/Outcome/);
    expect(missingMedicationErrorFields({ ...COMPLETE, description: "   " })).toEqual(["What happened"]);
  });

  it("builds the insert from the picked resident and trimmed narrative", () => {
    expect(buildMedicationErrorInsert({ ...COMPLETE, physicianNotified: true }, CONTEXT)).toEqual({
      resident_id: RESIDENT_ID,
      facility_id: CONTEXT.facilityId,
      organization_id: CONTEXT.organizationId,
      error_type: "wrong_dose",
      severity: "no_harm",
      shift: "evening",
      discovered_by: CONTEXT.userId,
      created_by: CONTEXT.userId,
      description: "Dose given twice",
      immediate_actions: "Vitals checked",
      contributing_factors: null,
      physician_notified: true,
      physician_notified_at: "2026-09-22T12:00:00.000Z",
    });
  });
});

describe("medication error report page", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../../app/(admin)/admin/medications/errors/new/page.tsx"),
    "utf8",
  );

  it("picks the resident from the facility census instead of a typed UUID", () => {
    expect(source).not.toMatch(/UUID/);
    expect(source).not.toContain('id="resident_id"');
    expect(source).toContain("fetchActiveResidentsWithRooms");
    expect(source).toContain("EntityCombobox");
  });

  it("does not pre-fill any classification", () => {
    expect(source).toContain("EMPTY_MEDICATION_ERROR_FORM");
    expect(source).not.toMatch(/useState<string>\("(wrong_medication|near_miss|day)"\)/);
  });
});
