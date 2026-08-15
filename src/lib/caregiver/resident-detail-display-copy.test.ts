import { describe, expect, it } from "vitest";

import {
  CAREGIVER_RESIDENT_NO_ACUITY_COPY,
  CAREGIVER_RESIDENT_NO_MOOD_COPY,
  CAREGIVER_RESIDENT_NO_ROOM_COPY,
  formatCaregiverResidentAcuity,
  formatCaregiverResidentMood,
  formatCaregiverResidentRoomLabel,
} from "./resident-detail-display-copy";

describe("formatCaregiverResidentAcuity", () => {
  it("names the gap for null, empty, whitespace, and silent dash", () => {
    expect(formatCaregiverResidentAcuity(null)).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
    expect(formatCaregiverResidentAcuity(undefined)).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
    expect(formatCaregiverResidentAcuity("")).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
    expect(formatCaregiverResidentAcuity("   ")).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
    expect(formatCaregiverResidentAcuity("—")).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
  });

  it("returns posted acuity as-is (trim only)", () => {
    expect(formatCaregiverResidentAcuity("Level 3")).toBe("Level 3");
    expect(formatCaregiverResidentAcuity("  Level 2  ")).toBe("Level 2");
    expect(formatCaregiverResidentAcuity(3)).toBe("3");
  });

  it("keeps numeric zero when acuity is numeric", () => {
    expect(formatCaregiverResidentAcuity(0)).toBe("0");
  });
});

describe("formatCaregiverResidentMood", () => {
  it("names the gap for null, empty, whitespace, and silent dash", () => {
    expect(formatCaregiverResidentMood(null)).toBe(CAREGIVER_RESIDENT_NO_MOOD_COPY);
    expect(formatCaregiverResidentMood(undefined)).toBe(CAREGIVER_RESIDENT_NO_MOOD_COPY);
    expect(formatCaregiverResidentMood("")).toBe(CAREGIVER_RESIDENT_NO_MOOD_COPY);
    expect(formatCaregiverResidentMood("   ")).toBe(CAREGIVER_RESIDENT_NO_MOOD_COPY);
    expect(formatCaregiverResidentMood("—")).toBe(CAREGIVER_RESIDENT_NO_MOOD_COPY);
  });

  it("returns posted mood as-is (trim only)", () => {
    expect(formatCaregiverResidentMood("Calm")).toBe("Calm");
    expect(formatCaregiverResidentMood("  Restless  ")).toBe("Restless");
  });
});

describe("formatCaregiverResidentRoomLabel", () => {
  it("names the gap when room number is missing", () => {
    expect(formatCaregiverResidentRoomLabel(null)).toBe(CAREGIVER_RESIDENT_NO_ROOM_COPY);
    expect(formatCaregiverResidentRoomLabel(undefined)).toBe(CAREGIVER_RESIDENT_NO_ROOM_COPY);
    expect(formatCaregiverResidentRoomLabel("")).toBe(CAREGIVER_RESIDENT_NO_ROOM_COPY);
    expect(formatCaregiverResidentRoomLabel("   ")).toBe(CAREGIVER_RESIDENT_NO_ROOM_COPY);
  });

  it("returns posted room as Room {number}", () => {
    expect(formatCaregiverResidentRoomLabel("101")).toBe("Room 101");
    expect(formatCaregiverResidentRoomLabel("  202  ")).toBe("Room 202");
  });
});
