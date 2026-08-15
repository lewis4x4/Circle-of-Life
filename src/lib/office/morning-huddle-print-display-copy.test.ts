import { describe, expect, it } from "vitest";

import {
  MORNING_HUDDLE_PRINT_NO_REASON_COPY,
  MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY,
  MORNING_HUDDLE_PRINT_NO_SHIFT_COPY,
  formatMorningHuddlePrintAssignedShift,
  formatMorningHuddlePrintMissedMedReason,
  formatMorningHuddlePrintResidentName,
} from "./morning-huddle-print-display-copy";

const EM_DASH = "—";

describe("formatMorningHuddlePrintResidentName", () => {
  it("names a missing resident instead of an em dash", () => {
    expect(formatMorningHuddlePrintResidentName(null)).toBe(
      MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY,
    );
    expect(formatMorningHuddlePrintResidentName(undefined)).toBe(
      MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY,
    );
    expect(formatMorningHuddlePrintResidentName(null)).not.toBe(EM_DASH);
  });

  it("names a blank resident instead of an em dash", () => {
    expect(formatMorningHuddlePrintResidentName("")).toBe(MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY);
    expect(formatMorningHuddlePrintResidentName("   ")).toBe(
      MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY,
    );
  });

  it("names an em dash resident instead of a silent dash", () => {
    expect(formatMorningHuddlePrintResidentName(EM_DASH)).toBe(
      MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY,
    );
    expect(formatMorningHuddlePrintResidentName(`  ${EM_DASH}  `)).toBe(
      MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY,
    );
  });

  it("returns a posted resident name trimmed", () => {
    expect(formatMorningHuddlePrintResidentName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatMorningHuddlePrintResidentName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});

describe("formatMorningHuddlePrintAssignedShift", () => {
  it("names a missing shift instead of an em dash", () => {
    expect(formatMorningHuddlePrintAssignedShift(null)).toBe(MORNING_HUDDLE_PRINT_NO_SHIFT_COPY);
    expect(formatMorningHuddlePrintAssignedShift(undefined)).toBe(
      MORNING_HUDDLE_PRINT_NO_SHIFT_COPY,
    );
    expect(formatMorningHuddlePrintAssignedShift("")).toBe(MORNING_HUDDLE_PRINT_NO_SHIFT_COPY);
    expect(formatMorningHuddlePrintAssignedShift("   ")).toBe(MORNING_HUDDLE_PRINT_NO_SHIFT_COPY);
    expect(formatMorningHuddlePrintAssignedShift(null)).not.toBe(EM_DASH);
  });

  it("humanizes a posted shift value", () => {
    expect(formatMorningHuddlePrintAssignedShift("day_shift")).toBe("day shift");
    expect(formatMorningHuddlePrintAssignedShift("  night_shift  ")).toBe("night shift");
  });
});

describe("formatMorningHuddlePrintMissedMedReason", () => {
  it("names a missing reason instead of an em dash", () => {
    expect(formatMorningHuddlePrintMissedMedReason(null)).toBe(
      MORNING_HUDDLE_PRINT_NO_REASON_COPY,
    );
    expect(formatMorningHuddlePrintMissedMedReason(undefined)).toBe(
      MORNING_HUDDLE_PRINT_NO_REASON_COPY,
    );
    expect(formatMorningHuddlePrintMissedMedReason(null)).not.toBe(EM_DASH);
  });

  it("names a blank reason instead of an em dash", () => {
    expect(formatMorningHuddlePrintMissedMedReason("")).toBe(MORNING_HUDDLE_PRINT_NO_REASON_COPY);
    expect(formatMorningHuddlePrintMissedMedReason("   ")).toBe(
      MORNING_HUDDLE_PRINT_NO_REASON_COPY,
    );
  });

  it("names an em dash reason instead of a silent dash", () => {
    expect(formatMorningHuddlePrintMissedMedReason(EM_DASH)).toBe(
      MORNING_HUDDLE_PRINT_NO_REASON_COPY,
    );
    expect(formatMorningHuddlePrintMissedMedReason(`  ${EM_DASH}  `)).toBe(
      MORNING_HUDDLE_PRINT_NO_REASON_COPY,
    );
  });

  it("returns a posted reason trimmed", () => {
    expect(formatMorningHuddlePrintMissedMedReason("Resident refused")).toBe("Resident refused");
    expect(formatMorningHuddlePrintMissedMedReason("  Held per physician order  ")).toBe(
      "Held per physician order",
    );
  });
});
