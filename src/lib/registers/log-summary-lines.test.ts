import { describe, expect, it } from "vitest";

import { frontDeskSummaryLine, handoffSummaryLine } from "./log-summary-lines";

const ok = { facilityReady: true, loading: false, error: null };

describe("front desk / handoff count lines (COL-649)", () => {
  it("states no counts with no facility chosen", () => {
    expect(frontDeskSummaryLine({ ...ok, facilityReady: false, onSiteCount: 0, pendingPackages: 0 })).toBeNull();
    expect(handoffSummaryLine({ ...ok, facilityReady: false, openCount: 0 })).toBeNull();
  });

  it("states no counts while loading or after a failed read", () => {
    expect(frontDeskSummaryLine({ ...ok, loading: true, onSiteCount: 0, pendingPackages: 0 })).toBeNull();
    expect(handoffSummaryLine({ ...ok, error: "403", openCount: 0 })).toBeNull();
  });

  it("waits for the visitor log before saying who is on site", () => {
    expect(frontDeskSummaryLine({ ...ok, onSiteCount: null, pendingPackages: 2 })).toBeNull();
  });

  it("states real counts", () => {
    expect(frontDeskSummaryLine({ ...ok, onSiteCount: 0, pendingPackages: 1 })).toBe(
      "0 on site · 1 package awaiting pickup.",
    );
    expect(handoffSummaryLine({ ...ok, openCount: 3 })).toBe("3 unacknowledged on this shift.");
  });
});
