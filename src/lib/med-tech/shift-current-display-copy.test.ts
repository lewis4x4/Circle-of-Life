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
  formatShiftCurrentWindowLabel,
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

  it("returns First Last when posted (COL-686)", () => {
    expect(
      formatShiftCurrentResidentName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: null,
      }),
    ).toBe("Jordan Lee");
    expect(
      formatShiftCurrentResidentName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: "Jay",
      }),
    ).toBe("Jay Lee");
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

  it("returns first name and last initial when posted (COL-686)", () => {
    expect(
      formatShiftCurrentResidentCompactName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: null,
      }),
    ).toBe("Jordan L.");
    expect(
      formatShiftCurrentResidentCompactName({
        first_name: "Jordan",
        last_name: "Lee",
        preferred_name: "Jay",
      }),
    ).toBe("Jay L.");
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

describe("formatShiftCurrentWindowLabel (COL-668)", () => {
  const hhmm = (iso: string) => iso.slice(11, 16);

  it("shows the shift window from the facility's shift times", () => {
    expect(formatShiftCurrentWindowLabel("2026-09-23T07:00:00", "2026-09-23T19:00:00", hhmm)).toBe("AM · 07:00 - 19:00");
  });

  it("says the shift is open rather than inventing an end when the facility has no shift times", () => {
    expect(formatShiftCurrentWindowLabel("2026-09-23T19:00:00", null, hhmm)).toBe("PM · 19:00 - open");
  });
});
