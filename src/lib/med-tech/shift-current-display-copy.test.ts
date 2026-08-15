import { describe, expect, it } from "vitest";

import {
  SHIFT_CURRENT_NO_MEDICATION_COPY,
  SHIFT_CURRENT_NO_NAME_COPY,
  SHIFT_CURRENT_NO_RESIDENT_COPY,
  SHIFT_CURRENT_NO_ROOM_COPY,
  formatShiftCurrentMedicationLabel,
  formatShiftCurrentResidentCompactName,
  formatShiftCurrentResidentName,
  formatShiftCurrentRoomLabel,
} from "./shift-current-display-copy";

const EM_DASH = "—";

describe("formatShiftCurrentResidentName", () => {
  it("names a missing resident instead of Unknown", () => {
    expect(formatShiftCurrentResidentName(null)).toBe(SHIFT_CURRENT_NO_RESIDENT_COPY);
    expect(formatShiftCurrentResidentName(undefined)).toBe(SHIFT_CURRENT_NO_RESIDENT_COPY);
    expect(formatShiftCurrentResidentName(null)).not.toBe("Unknown");
  });

  it("names blank resident names instead of inventing one", () => {
    expect(formatShiftCurrentResidentName({ first_name: null, last_name: null })).toBe(
      SHIFT_CURRENT_NO_NAME_COPY,
    );
    expect(formatShiftCurrentResidentName({ first_name: "", last_name: "" })).toBe(
      SHIFT_CURRENT_NO_NAME_COPY,
    );
    expect(formatShiftCurrentResidentName({ first_name: "   ", last_name: "  " })).toBe(
      SHIFT_CURRENT_NO_NAME_COPY,
    );
  });

  it("returns last-name-first when posted", () => {
    expect(
      formatShiftCurrentResidentName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: null,
      }),
    ).toBe("Lee, Jordan");
    expect(
      formatShiftCurrentResidentName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: "Jay",
      }),
    ).toBe("Lee, Jay");
  });
});

describe("formatShiftCurrentResidentCompactName", () => {
  it("names a missing resident instead of Unknown", () => {
    expect(formatShiftCurrentResidentCompactName(null)).toBe(SHIFT_CURRENT_NO_RESIDENT_COPY);
  });

  it("names blank resident names instead of inventing one", () => {
    expect(formatShiftCurrentResidentCompactName({ first_name: null, last_name: null })).toBe(
      SHIFT_CURRENT_NO_NAME_COPY,
    );
  });

  it("returns last-name-first initial when posted", () => {
    expect(
      formatShiftCurrentResidentCompactName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: null,
      }),
    ).toBe("Lee, J.");
    expect(
      formatShiftCurrentResidentCompactName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: "Jay",
      }),
    ).toBe("Lee, J.");
  });
});

describe("formatShiftCurrentMedicationLabel", () => {
  it("names a missing medication instead of Unknown", () => {
    expect(formatShiftCurrentMedicationLabel(null)).toBe(SHIFT_CURRENT_NO_MEDICATION_COPY);
    expect(formatShiftCurrentMedicationLabel(undefined)).toBe(SHIFT_CURRENT_NO_MEDICATION_COPY);
    expect(formatShiftCurrentMedicationLabel(null)).not.toBe("Unknown");
  });

  it("names blank medication fields instead of inventing one", () => {
    expect(formatShiftCurrentMedicationLabel({ medication_name: null, strength: null })).toBe(
      SHIFT_CURRENT_NO_MEDICATION_COPY,
    );
    expect(formatShiftCurrentMedicationLabel({ medication_name: "", strength: "" })).toBe(
      SHIFT_CURRENT_NO_MEDICATION_COPY,
    );
    expect(formatShiftCurrentMedicationLabel({ medication_name: "   ", strength: EM_DASH })).toBe(
      SHIFT_CURRENT_NO_MEDICATION_COPY,
    );
  });

  it("returns trimmed medication name and strength when posted", () => {
    expect(
      formatShiftCurrentMedicationLabel({
        medication_name: "Acetaminophen",
        strength: "500 mg",
      }),
    ).toBe("Acetaminophen 500 mg");
    expect(
      formatShiftCurrentMedicationLabel({
        medication_name: "  Acetaminophen  ",
        strength: " 500 mg ",
      }),
    ).toBe("Acetaminophen 500 mg");
  });
});

describe("formatShiftCurrentRoomLabel", () => {
  it("names a missing room instead of a silent dash", () => {
    expect(formatShiftCurrentRoomLabel(null)).toBe(SHIFT_CURRENT_NO_ROOM_COPY);
    expect(formatShiftCurrentRoomLabel(undefined)).toBe(SHIFT_CURRENT_NO_ROOM_COPY);
    expect(formatShiftCurrentRoomLabel("-")).toBe(SHIFT_CURRENT_NO_ROOM_COPY);
    expect(formatShiftCurrentRoomLabel(EM_DASH)).toBe(SHIFT_CURRENT_NO_ROOM_COPY);
  });

  it("names blank room instead of a silent dash", () => {
    expect(formatShiftCurrentRoomLabel("")).toBe(SHIFT_CURRENT_NO_ROOM_COPY);
    expect(formatShiftCurrentRoomLabel("   ")).toBe(SHIFT_CURRENT_NO_ROOM_COPY);
  });

  it("returns trimmed room when posted", () => {
    expect(formatShiftCurrentRoomLabel("Room 12")).toBe("Room 12");
    expect(formatShiftCurrentRoomLabel("  Room 12  ")).toBe("Room 12");
  });
});
