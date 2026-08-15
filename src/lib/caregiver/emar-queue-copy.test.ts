import { describe, expect, it } from "vitest";

import {
  CAREGIVER_EMAR_NO_ROOM_LABEL,
  caregiverEmarEmptyNoticeHelper,
  caregiverEmarEmptyNoticeTitle,
  caregiverEmarMetricDisplay,
  caregiverEmarMetricEmptyCopy,
  formatCaregiverEmarRoomLabel,
} from "./emar-queue-copy";

describe("formatCaregiverEmarRoomLabel", () => {
  it("formats room and bed when both are present", () => {
    expect(formatCaregiverEmarRoomLabel({ roomNumber: "204", bedLabel: "A" })).toBe("204-A");
  });

  it("returns room only when bed label is missing", () => {
    expect(formatCaregiverEmarRoomLabel({ roomNumber: "204", bedLabel: null })).toBe("204");
  });

  it("names the gap when room data is missing", () => {
    expect(formatCaregiverEmarRoomLabel({ roomNumber: null, bedLabel: "A" })).toBe(
      CAREGIVER_EMAR_NO_ROOM_LABEL,
    );
    expect(formatCaregiverEmarRoomLabel({ roomNumber: "", bedLabel: "A" })).toBe(
      CAREGIVER_EMAR_NO_ROOM_LABEL,
    );
  });
});

describe("caregiverEmarMetricEmptyCopy", () => {
  it("names each empty pass metric", () => {
    expect(caregiverEmarMetricEmptyCopy("due-now")).toBe("No doses due now");
    expect(caregiverEmarMetricEmptyCopy("due-soon")).toBe("No doses due soon");
    expect(caregiverEmarMetricEmptyCopy("in-window")).toBe("No doses in this window");
  });
});

describe("caregiverEmarMetricDisplay", () => {
  it("uses message copy when the queue is empty", () => {
    expect(caregiverEmarMetricDisplay(0, "due-now", false)).toEqual({
      mode: "message",
      text: "No doses due now",
    });
    expect(caregiverEmarMetricDisplay(0, "due-soon", false)).toEqual({
      mode: "message",
      text: "No doses due soon",
    });
    expect(caregiverEmarMetricDisplay(0, "in-window", false)).toEqual({
      mode: "message",
      text: "No doses in this window",
    });
  });

  it("keeps numeric zeros when slots exist but none are due now", () => {
    expect(caregiverEmarMetricDisplay(0, "due-now", true)).toEqual({
      mode: "number",
      text: "0",
    });
    expect(caregiverEmarMetricDisplay(2, "due-soon", true)).toEqual({
      mode: "number",
      text: "2",
    });
  });
});

describe("caregiverEmarEmptyNotice", () => {
  it("explains an empty pass window in one title and helper line", () => {
    expect(caregiverEmarEmptyNoticeTitle()).toBe("No doses in this pass window");
    expect(caregiverEmarEmptyNoticeHelper()).toContain("active medications with scheduled times");
  });
});
