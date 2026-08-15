import { describe, expect, it } from "vitest";

import {
  MEDICATIONS_NO_NAME_COPY,
  MEDICATIONS_NO_PRESCRIBER_COPY,
  MEDICATIONS_NO_STRENGTH_COPY,
  formatMedicationName,
  formatMedicationPrescriber,
  formatMedicationStrength,
} from "./medications-display-copy";

const EM_DASH = "—";

describe("formatMedicationStrength", () => {
  it("names missing strength instead of an em dash", () => {
    expect(formatMedicationStrength(null)).toBe(MEDICATIONS_NO_STRENGTH_COPY);
    expect(formatMedicationStrength(undefined)).toBe(MEDICATIONS_NO_STRENGTH_COPY);
    expect(formatMedicationStrength("")).toBe(MEDICATIONS_NO_STRENGTH_COPY);
    expect(formatMedicationStrength("   ")).toBe(MEDICATIONS_NO_STRENGTH_COPY);
    expect(formatMedicationStrength("—")).toBe(MEDICATIONS_NO_STRENGTH_COPY);
    expect(formatMedicationStrength("  —  ")).toBe(MEDICATIONS_NO_STRENGTH_COPY);
    expect(formatMedicationStrength(null)).not.toBe(EM_DASH);
  });

  it("returns a posted strength (trim only)", () => {
    expect(formatMedicationStrength("10 mg")).toBe("10 mg");
    expect(formatMedicationStrength("  10 mg  ")).toBe("10 mg");
  });
});

describe("formatMedicationName", () => {
  it("names missing medication name instead of an em dash", () => {
    expect(formatMedicationName(null)).toBe(MEDICATIONS_NO_NAME_COPY);
    expect(formatMedicationName(undefined)).toBe(MEDICATIONS_NO_NAME_COPY);
    expect(formatMedicationName("")).toBe(MEDICATIONS_NO_NAME_COPY);
    expect(formatMedicationName("   ")).toBe(MEDICATIONS_NO_NAME_COPY);
    expect(formatMedicationName("—")).toBe(MEDICATIONS_NO_NAME_COPY);
    expect(formatMedicationName("  —  ")).toBe(MEDICATIONS_NO_NAME_COPY);
    expect(formatMedicationName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted medication name (trim only)", () => {
    expect(formatMedicationName("Medication A")).toBe("Medication A");
    expect(formatMedicationName("  Medication A  ")).toBe("Medication A");
  });
});

describe("formatMedicationPrescriber", () => {
  it("names missing prescriber instead of an em dash", () => {
    expect(formatMedicationPrescriber(null)).toBe(MEDICATIONS_NO_PRESCRIBER_COPY);
    expect(formatMedicationPrescriber(undefined)).toBe(MEDICATIONS_NO_PRESCRIBER_COPY);
    expect(formatMedicationPrescriber("")).toBe(MEDICATIONS_NO_PRESCRIBER_COPY);
    expect(formatMedicationPrescriber("   ")).toBe(MEDICATIONS_NO_PRESCRIBER_COPY);
    expect(formatMedicationPrescriber("—")).toBe(MEDICATIONS_NO_PRESCRIBER_COPY);
    expect(formatMedicationPrescriber("  —  ")).toBe(MEDICATIONS_NO_PRESCRIBER_COPY);
    expect(formatMedicationPrescriber(null)).not.toBe(EM_DASH);
  });

  it("returns a posted prescriber name (trim only)", () => {
    expect(formatMedicationPrescriber("Dr. Example")).toBe("Dr. Example");
    expect(formatMedicationPrescriber("  Dr. Example  ")).toBe("Dr. Example");
  });
});
