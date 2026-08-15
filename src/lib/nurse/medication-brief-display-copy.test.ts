import { describe, expect, it } from "vitest";

import {
  formatNurseWatchlistRoomLabel,
  NURSE_WATCHLIST_NO_ROOM_COPY,
} from "./medication-brief-display-copy";

const EM_DASH = "—";

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
