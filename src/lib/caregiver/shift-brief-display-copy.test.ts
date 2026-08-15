import { describe, expect, it } from "vitest";

import {
  CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY,
  caregiverShiftBriefDisplayRoomLabel,
  formatCaregiverShiftBriefRoomLabel,
} from "./shift-brief-display-copy";

describe("formatCaregiverShiftBriefRoomLabel", () => {
  it("formats room and bed when both are posted", () => {
    expect(formatCaregiverShiftBriefRoomLabel({ roomNumber: "12A", bedLabel: "B" })).toBe("12A-B");
  });

  it("returns trimmed room only when bed label is missing", () => {
    expect(formatCaregiverShiftBriefRoomLabel({ roomNumber: "12A", bedLabel: null })).toBe("12A");
    expect(formatCaregiverShiftBriefRoomLabel({ roomNumber: "  12A  ", bedLabel: "" })).toBe("12A");
  });

  it("names the gap when room data is missing or blank", () => {
    expect(formatCaregiverShiftBriefRoomLabel({ roomNumber: null, bedLabel: "B" })).toBe(
      CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY,
    );
    expect(formatCaregiverShiftBriefRoomLabel({ roomNumber: "", bedLabel: "B" })).toBe(
      CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY,
    );
    expect(formatCaregiverShiftBriefRoomLabel({ roomNumber: "   ", bedLabel: "B" })).toBe(
      CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY,
    );
    expect(formatCaregiverShiftBriefRoomLabel({})).toBe(CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY);
  });
});

describe("caregiverShiftBriefDisplayRoomLabel", () => {
  it("returns explicit copy instead of a silent dash", () => {
    expect(caregiverShiftBriefDisplayRoomLabel(null)).toBe(CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY);
    expect(caregiverShiftBriefDisplayRoomLabel(undefined)).toBe(CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY);
    expect(caregiverShiftBriefDisplayRoomLabel("")).toBe(CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY);
    expect(caregiverShiftBriefDisplayRoomLabel("   ")).toBe(CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY);
    expect(caregiverShiftBriefDisplayRoomLabel("—")).toBe(CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY);
  });

  it("keeps a posted room label trimmed as-is", () => {
    expect(caregiverShiftBriefDisplayRoomLabel("12A-B")).toBe("12A-B");
    expect(caregiverShiftBriefDisplayRoomLabel(" 12A ")).toBe("12A");
  });
});
