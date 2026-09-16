import { describe, expect, it } from "vitest";

import { recordedDiagnoses } from "./resident-diagnosis-display";

describe("recordedDiagnoses", () => {
  it("does not show a combined primary string as one more diagnosis beside its parts", () => {
    const result = recordedDiagnoses(
      "Osteopenia, Gerd, Colon Polyps, Depression Basal, Cell carcinoma, Memory loss",
      ["Osteopenia", "Gerd", "Colon Polyps", "Depression Basal", "Cell carcinoma", "Memory loss"],
    );
    expect(result.conditions).toEqual([
      "Osteopenia",
      "GERD",
      "Colon Polyps",
      "Depression Basal",
      "Cell Carcinoma",
      "Memory Loss",
    ]);
    expect(result.primary).toBeNull();
    expect(result.combinedPrimaryAsEntered).toBe(
      "Osteopenia, Gerd, Colon Polyps, Depression Basal, Cell carcinoma, Memory loss",
    );
    // The combined string never appears as a condition of its own.
    expect(result.conditions.some((c) => c.includes(";") || c.includes(","))).toBe(false);
  });

  it("keeps a single primary diagnosis as the primary and lists the rest once", () => {
    const result = recordedDiagnoses("copd", ["COPD", "Hypertension", "hypertension "]);
    expect(result.primary).toBe("COPD");
    expect(result.combinedPrimaryAsEntered).toBeNull();
    expect(result.conditions).toEqual(["COPD", "Hypertension"]);
  });

  it("keeps mis-split source entries as recorded instead of repairing clinical text", () => {
    const result = recordedDiagnoses(null, ["Depression Basal", "Cell carcinoma"]);
    expect(result.conditions).toEqual(["Depression Basal", "Cell Carcinoma"]);
  });

  it("returns nothing when neither field is recorded", () => {
    expect(recordedDiagnoses(null, null)).toEqual({
      conditions: [],
      primary: null,
      combinedPrimaryAsEntered: null,
    });
    expect(recordedDiagnoses("  ", [" ", ""])).toEqual({
      conditions: [],
      primary: null,
      combinedPrimaryAsEntered: null,
    });
  });
});
