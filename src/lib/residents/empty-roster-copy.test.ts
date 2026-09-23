import { describe, expect, it } from "vitest";

import { censusDisagreementCopy, emptyRosterCopy } from "./empty-roster-copy";

describe("emptyRosterCopy (COL-670)", () => {
  it("names the facility", () => {
    expect(emptyRosterCopy("Oakridge ALF")).toBe("No residents are on the roster for Oakridge ALF yet.");
  });

  it("falls back to this facility when the name is not loaded", () => {
    expect(emptyRosterCopy(null)).toBe("No residents are on the roster for this facility yet.");
    expect(emptyRosterCopy("  ")).toBe("No residents are on the roster for this facility yet.");
  });
});

describe("censusDisagreementCopy (COL-670)", () => {
  it("turns Stand Up 47 vs an empty roster into one message with the next step", () => {
    expect(
      censusDisagreementCopy({ facilityName: "Oakridge ALF", rosterTotal: 0, standUpValue: 47, standUpWeekStart: "2026-09-21" }),
    ).toBe(
      "No residents are on the roster for Oakridge ALF yet. Weekly Stand Up reported 47 for the week of 2026-09-21, so those residents are not in Haven yet: add them through an admission, or correct the Stand Up census.",
    );
  });

  it("names both numbers and what to check when both are non-zero", () => {
    expect(
      censusDisagreementCopy({ facilityName: "Homewood Lodge", rosterTotal: 33, standUpValue: 35, standUpWeekStart: "2026-09-21" }),
    ).toBe(
      "Weekly Stand Up reported 35 for the week of 2026-09-21; the roster shows 33. Check the roster against who is in the building, then correct whichever is wrong.",
    );
  });
});
