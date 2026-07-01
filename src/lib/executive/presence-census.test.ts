import { describe, expect, it } from "vitest";

import { EMPTY_PRESENCE_CENSUS, summarizePresenceCensus } from "./presence-census";

describe("summarizePresenceCensus", () => {
  it("splits the occupied population into in-house vs on-hold using standup vocabulary", () => {
    const census = summarizePresenceCensus([
      { status: "active" },
      { status: "active" },
      { status: "active" },
      { status: "hospital_hold" },
      { status: "loa" },
    ]);
    expect(census).toEqual({ inHouse: 3, hospital: 1, onLeave: 1, onHold: 2, total: 5 });
  });

  it("counts hospital_hold + loa as on-hold (still occupied, never a second occupancy)", () => {
    const census = summarizePresenceCensus([
      { status: "hospital_hold" },
      { status: "hospital_hold" },
      { status: "loa" },
    ]);
    expect(census.onHold).toBe(3);
    expect(census.total).toBe(3);
    expect(census.inHouse).toBe(0);
  });

  it("ignores non-presence lifecycle statuses that slip through", () => {
    const census = summarizePresenceCensus([
      { status: "active" },
      { status: "discharged" },
      { status: "deceased" },
      { status: null },
    ]);
    expect(census).toEqual({ inHouse: 1, hospital: 0, onLeave: 0, onHold: 0, total: 1 });
  });

  it("returns an all-zero census for no residents", () => {
    expect(summarizePresenceCensus([])).toEqual(EMPTY_PRESENCE_CENSUS);
  });
});
