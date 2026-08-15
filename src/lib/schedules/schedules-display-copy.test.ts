import { describe, expect, it } from "vitest";

import {
  SCHEDULES_NO_PUBLISH_TIME_COPY,
  formatSchedulePublishedAt,
  formatSchedulePublishedSubtitle,
} from "./schedules-display-copy";

const EM_DASH = "—";

describe("formatSchedulePublishedAt", () => {
  it("names a missing publish time instead of an em dash", () => {
    expect(formatSchedulePublishedAt(null)).toBe(SCHEDULES_NO_PUBLISH_TIME_COPY);
    expect(formatSchedulePublishedAt(undefined)).toBe(SCHEDULES_NO_PUBLISH_TIME_COPY);
    expect(formatSchedulePublishedAt("")).toBe(SCHEDULES_NO_PUBLISH_TIME_COPY);
    expect(formatSchedulePublishedAt("   ")).toBe(SCHEDULES_NO_PUBLISH_TIME_COPY);
    expect(formatSchedulePublishedAt(null)).not.toBe(EM_DASH);
  });

  it("formats a posted publish datetime", () => {
    const formatted = formatSchedulePublishedAt("2026-08-15T14:30:00.000Z");
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
  });
});

describe("formatSchedulePublishedSubtitle", () => {
  it("uses missing publish copy when published_at is absent", () => {
    expect(formatSchedulePublishedSubtitle(null, null)).toBe(
      `Published: ${SCHEDULES_NO_PUBLISH_TIME_COPY}`,
    );
    expect(formatSchedulePublishedSubtitle(null, null)).not.toContain(EM_DASH);
  });

  it("appends trimmed notes when present", () => {
    expect(formatSchedulePublishedSubtitle(null, "Floor review complete")).toBe(
      `Published: ${SCHEDULES_NO_PUBLISH_TIME_COPY} · Floor review complete`,
    );
  });

  it("formats posted publish time with notes", () => {
    const subtitle = formatSchedulePublishedSubtitle("2026-08-15T14:30:00.000Z", "Ready for floor");
    expect(subtitle).toMatch(/^Published: Aug/);
    expect(subtitle).toContain("Ready for floor");
  });
});
