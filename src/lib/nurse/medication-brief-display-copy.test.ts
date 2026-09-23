import { describe, expect, it } from "vitest";

import {
  describeControlledCounts,
  describeEmarCompliance,
  describeMedErrors7d,
  formatDoseAlertCount,
  formatNurseWatchlistRoomLabel,
  NURSE_WATCHLIST_NO_ROOM_COPY,
} from "./medication-brief-display-copy";

const EM_DASH = "—";

describe("formatDoseAlertCount", () => {
  it("keeps a real zero distinct from an unavailable count", () => {
    expect(formatDoseAlertCount(0)).toBe(0);
    expect(formatDoseAlertCount(null)).toBe("None posted");
  });
});

describe("NURSE_WATCHLIST_NO_ROOM_COPY", () => {
  it("names the assurance watchlist room gap instead of a silent dash", () => {
    expect(NURSE_WATCHLIST_NO_ROOM_COPY).toBe("No room posted");
    expect(NURSE_WATCHLIST_NO_ROOM_COPY).not.toBe(EM_DASH);
  });
});

describe("formatNurseWatchlistRoomLabel", () => {
  it.each([
    ["", "Safety watch"],
    ["   ", "Safety watch"],
    [EM_DASH, "Safety watch"],
    [NURSE_WATCHLIST_NO_ROOM_COPY, "Safety watch"],
  ])("maps %j to Safety watch when room is not posted", (room, expected) => {
    expect(formatNurseWatchlistRoomLabel(room)).toBe(expected);
  });

  it("shows Room prefix for posted rooms", () => {
    expect(formatNurseWatchlistRoomLabel("204A")).toBe("Room 204A");
  });
});

describe("describeControlledCounts", () => {
  it("never renders a failed read as an all-clear", () => {
    const card = describeControlledCounts(null, 12);
    expect(card.value).toBe("Unavailable");
    expect(card.value).not.toBe(0);
    expect(card.subLabel).toMatch(/unavailable/i);
    expect(card.subLabel).not.toBe("All verified");
    expect(card.urgency).toBe("critical");
  });

  it("keeps a real zero as all verified and flags open discrepancies", () => {
    expect(describeControlledCounts(0, 12)).toEqual({ value: 0, urgency: "normal", subLabel: "All verified" });
    expect(describeControlledCounts(3, 12)).toEqual({ value: 3, urgency: "critical", subLabel: "Discrepancies found" });
  });

  it("does not say All verified when no count is on file (COL-649)", () => {
    const card = describeControlledCounts(0, 0);
    expect(card.subLabel).not.toBe("All verified");
    expect(card).toEqual({ value: "No counts", urgency: "normal", subLabel: "No controlled substance counts on file" });
    expect(describeControlledCounts(0, null).value).toBe("Unavailable");
  });
});

describe("describeMedErrors7d / describeEmarCompliance", () => {
  it("show unavailable instead of 0 / 100% on a failed read", () => {
    expect(describeMedErrors7d(null).value).toBe("Unavailable");
    expect(describeMedErrors7d(null).subLabel).not.toBe("None reported");
    expect(describeEmarCompliance(null, null).value).toBe("Unavailable");
    expect(describeEmarCompliance(100, 20).value).toBe("100%");
  });

  it("eMAR is not 100% over zero scheduled doses (COL-649)", () => {
    expect(describeEmarCompliance(null, 0)).toEqual({
      value: "No doses",
      urgency: "normal",
      subLabel: "No eMAR doses scheduled today",
    });
  });
});
