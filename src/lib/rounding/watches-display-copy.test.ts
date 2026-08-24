import { describe, expect, it } from "vitest";

import {
  OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY,
  WATCHES_BOARD_LOADING_COPY,
  WATCHES_BOARD_WATCH_TIMES_ET_CUE,
  formatWatchesBoardDateTime,
  formatWatchesBoardNoWatchesEmptyTitle,
  formatWatchesBoardPageSubtitle,
  resolveWatchesBoardFacilityScope,
} from "./watches-display-copy";

describe("resolveWatchesBoardFacilityScope", () => {
  it("returns unscoped when no facility is selected", () => {
    expect(resolveWatchesBoardFacilityScope(null, null)).toEqual({ kind: "unscoped" });
  });

  it("returns missing_name when a facility id is selected without a resolved name", () => {
    expect(resolveWatchesBoardFacilityScope("fac-anon-1", undefined)).toEqual({
      kind: "missing_name",
    });
    expect(resolveWatchesBoardFacilityScope("fac-anon-1", "   ")).toEqual({
      kind: "missing_name",
    });
  });

  it("returns a named scope when the facility name resolves", () => {
    expect(resolveWatchesBoardFacilityScope("fac-anon-1", "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatWatchesBoardPageSubtitle", () => {
  it("uses the shared select-facility gap when unscoped", () => {
    expect(formatWatchesBoardPageSubtitle({ kind: "unscoped" })).toBe(
      OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY,
    );
    expect(formatWatchesBoardPageSubtitle({ kind: "unscoped" })).not.toContain("selected facility");
  });

  it("interpolates the facility name only when resolved", () => {
    expect(formatWatchesBoardPageSubtitle({ kind: "named", name: "Anon Facility A" })).toContain(
      "Anon Facility A",
    );
  });

  it("never interpolates a missing-name gap into an at-facility sentence", () => {
    const subtitle = formatWatchesBoardPageSubtitle({ kind: "missing_name" });
    expect(subtitle).not.toContain(" at ");
    expect(subtitle).not.toContain("selected facility");
  });
});

describe("formatWatchesBoardNoWatchesEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(formatWatchesBoardNoWatchesEmptyTitle({ kind: "named", name: "Anon Facility A" })).toBe(
      "No watches at Anon Facility A",
    );
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatWatchesBoardNoWatchesEmptyTitle({ kind: "missing_name" })).toBe("No watches posted");
    expect(formatWatchesBoardNoWatchesEmptyTitle({ kind: "unscoped" })).toBe("No watches posted");
    expect(formatWatchesBoardNoWatchesEmptyTitle({ kind: "missing_name" })).not.toContain(" at ");
  });
});

describe("formatWatchesBoardDateTime", () => {
  it("formats parseable timestamps in America/New_York", () => {
    const formatted = formatWatchesBoardDateTime("2026-08-24T15:30:00.000Z");
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/24/);
    expect(formatted).toMatch(/2026/);
  });

  it("returns an em dash for missing or invalid values", () => {
    expect(formatWatchesBoardDateTime(null)).toBe("—");
    expect(formatWatchesBoardDateTime("")).toBe("—");
    expect(formatWatchesBoardDateTime("not-a-date")).toBe("—");
  });
});

describe("watches board constants", () => {
  it("exposes named loading copy", () => {
    expect(WATCHES_BOARD_LOADING_COPY).toContain("Loading");
    expect(WATCHES_BOARD_LOADING_COPY).not.toContain("selected facility");
  });

  it("exposes Eastern time cue for watch timestamps", () => {
    expect(WATCHES_BOARD_WATCH_TIMES_ET_CUE).toContain("Eastern (ET)");
  });
});
