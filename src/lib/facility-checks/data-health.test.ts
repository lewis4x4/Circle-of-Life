import { describe, expect, it } from "vitest";

import {
  censusComparisonLine,
  dataHealthCounts,
  formatStandUpWeek,
  lastCheckLine,
  type FacilityDataHealth,
} from "@/lib/facility-checks/data-health";

function health(overrides: Partial<FacilityDataHealth> = {}): FacilityDataHealth {
  return {
    beds_occupied_with_no_resident: 0,
    residents_holding_no_bed: 0,
    beds_with_two_residents: 0,
    roster_census: 25,
    stand_up_census: 34,
    stand_up_week_start: "2026-09-07",
    staff_inactive_can_still_sign_in: 0,
    active_profiles_with_no_grant: 0,
    duplicate_identity_candidates: 0,
    last_board_check_closed_at: null,
    last_staff_check_closed_at: null,
    ...overrides,
  };
}

describe("the counts", () => {
  it("reports every check with somewhere to go and look", () => {
    const counts = dataHealthCounts(
      health({
        beds_occupied_with_no_resident: 8,
        residents_holding_no_bed: 2,
        beds_with_two_residents: 1,
        staff_inactive_can_still_sign_in: 3,
        active_profiles_with_no_grant: 4,
        duplicate_identity_candidates: 5,
      }),
    );
    expect(counts.map((entry) => [entry.key, entry.count])).toEqual([
      ["beds_occupied_with_no_resident", 8],
      ["residents_holding_no_bed", 2],
      ["beds_with_two_residents", 1],
      ["staff_inactive_can_still_sign_in", 3],
      ["active_profiles_with_no_grant", 4],
      ["duplicate_identity_candidates", 5],
    ]);
    for (const entry of counts) {
      expect(entry.href.length).toBeGreaterThan(1);
      expect(entry.meaning.length).toBeGreaterThan(0);
    }
  });

  it("calls duplicate candidates suggestions rather than findings", () => {
    const duplicates = dataHealthCounts(health()).find((e) => e.key === "duplicate_identity_candidates");
    expect(duplicates?.meaning).toContain("Suggestions, not findings");
  });

  it("says a stranded occupied bed should be zero after migration 388", () => {
    const stranded = dataHealthCounts(health()).find((e) => e.key === "beds_occupied_with_no_resident");
    expect(stranded?.meaning).toContain("388");
  });
});

describe("roster beside Stand Up", () => {
  it("shows two plain numbers and the week, with no verdict", () => {
    const line = censusComparisonLine(health(), formatStandUpWeek);
    expect(line).toBe("Roster 25 · Stand Up Sep 7: 34");
    // Nothing in the line ranks one number above the other.
    expect(line).not.toMatch(/short|over|under|behind|wrong|off by/i);
  });

  it("says plainly when a facility has filed no Stand Up", () => {
    expect(
      censusComparisonLine(health({ stand_up_census: null, stand_up_week_start: null }), formatStandUpWeek),
    ).toBe("Roster 25 · Stand Up: none filed");
  });

  it("reads the week as the Monday it is, not shifted by a local timezone", () => {
    expect(formatStandUpWeek("2026-09-07")).toBe("Sep 7");
  });
});

describe("last closed checks", () => {
  it("says Never rather than leaving a blank", () => {
    expect(lastCheckLine(null, () => "x")).toBe("Never");
    expect(lastCheckLine("2026-09-16T19:42:00Z", () => "Sep 16, 3:42 p.m.")).toBe("Sep 16, 3:42 p.m.");
  });
});
