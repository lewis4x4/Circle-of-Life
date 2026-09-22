import { describe, expect, it } from "vitest";

import type { ResidentPresenceHistoryEntry } from "./resident-detail-overview-load";
import {
  PRESENCE_HISTORY_LIMIT,
  currentPresenceSpan,
  facilityDaysSince,
  mergePresenceRuns,
  presenceHistoryLines,
  presenceSinceSummary,
} from "./resident-presence-history";

const OUT: ResidentPresenceHistoryEntry = {
  id: "h2",
  status: "hospital_hold",
  // 2026-09-19 22:30 ET
  effectiveFrom: "2026-09-20T02:30:00.000Z",
  effectiveTo: null,
  recordedByName: "Jane Nurse",
  reason: null,
};
const BEFORE: ResidentPresenceHistoryEntry = {
  id: "h1",
  status: "active",
  effectiveFrom: "2025-12-26T12:00:00.000Z",
  effectiveTo: "2026-09-20T02:30:00.000Z",
  recordedByName: null,
  reason: null,
};

describe("COL-599: presence says since when and who", () => {
  it("reads the open span, the actor and the day of the stay in facility days", () => {
    const now = new Date("2026-09-22T16:00:00.000Z");
    const summary = presenceSinceSummary([OUT, BEFORE], "hospital_hold", now);
    expect(summary.sinceLabel).toBe("Since Sep 19, 2026, 10:30 PM");
    expect(summary.recordedByLabel).toBe("Recorded by Jane Nurse");
    expect(summary.awayDayLabel).toBe("Day 3 of this hospital stay");
  });

  it("says not recorded rather than borrowing a date when the open span disagrees or is missing", () => {
    expect(currentPresenceSpan([OUT], "active")).toBeNull();
    expect(presenceSinceSummary([], "loa").sinceLabel).toBe("Since not recorded");
    expect(presenceSinceSummary([BEFORE], "active").sinceLabel).toBe("Since not recorded");
  });

  it("counts facility days, not 24-hour periods", () => {
    // 11 PM ET out, 1 AM ET next day: one facility day in.
    expect(facilityDaysSince("2026-09-20T03:00:00.000Z", new Date("2026-09-20T05:00:00.000Z"))).toBe(1);
    expect(facilityDaysSince("2026-09-20T03:00:00.000Z", new Date("2026-09-20T03:30:00.000Z"))).toBe(0);
  });

  it("lists spans newest first with an unattributed actor stated as such", () => {
    const lines = presenceHistoryLines([OUT, BEFORE]);
    expect(lines[0]).toMatchObject({ statusLabel: "Bed Hold — Hospital", current: true });
    expect(lines[0].spanLabel).toMatch(/→ now$/);
    expect(lines[1]).toMatchObject({ statusLabel: "In-house", current: false, recordedByLabel: "Recorded by: not attributed" });
  });

  it("shows a span opened from the admission date as that date, not the evening before", () => {
    const admitted: ResidentPresenceHistoryEntry = {
      id: "h0",
      status: "active",
      effectiveFrom: "2025-12-26T00:00:00+00:00",
      effectiveTo: null,
      recordedByName: null,
      reason: null,
    };
    const summary = presenceSinceSummary([admitted], "active", new Date("2026-09-22T16:00:00.000Z"));
    expect(summary.sinceLabel).toBe("Since Dec 26, 2025 (time not recorded)");
    expect(summary.recordedByLabel).toBe("Opened from the admission date");
    expect(summary.awayDayLabel).toBeNull();
    expect(facilityDaysSince("2025-12-26T00:00:00+00:00", new Date("2025-12-27T16:00:00.000Z"))).toBe(1);
  });

  it("merges back-to-back rows of one status so a re-save does not reset 'since'", () => {
    const rows: ResidentPresenceHistoryEntry[] = [
      { id: "a", status: "active", effectiveFrom: "2026-09-22T03:45:00.000Z", effectiveTo: null, recordedByName: null, reason: null },
      { id: "b", status: "active", effectiveFrom: "2026-09-22T03:45:00.000Z", effectiveTo: "2026-09-22T03:45:00.000Z", recordedByName: null, reason: null },
      { id: "c", status: "active", effectiveFrom: "2026-09-22T02:53:00.000Z", effectiveTo: "2026-09-22T03:45:00.000Z", recordedByName: null, reason: null },
      { id: "d", status: "active", effectiveFrom: "2023-12-05T05:00:00.000Z", effectiveTo: "2026-09-22T02:53:00.000Z", recordedByName: "Admitting Nurse", reason: null },
    ];
    expect(mergePresenceRuns(rows)).toHaveLength(1);
    const summary = presenceSinceSummary(rows, "active");
    // Eastern midnight: a date cast in the facility's zone, shown as that date.
    expect(summary.sinceLabel).toBe("Since Dec 5, 2023 (time not recorded)");
    // A date-stamped run is never attributed to whoever the backfill named.
    expect(summary.recordedByLabel).toBe("Opened from the admission date");
    expect(presenceHistoryLines(rows)).toHaveLength(1);
  });

  it("says 'at least' when the run reaches the end of a capped read", () => {
    const rows: ResidentPresenceHistoryEntry[] = Array.from({ length: PRESENCE_HISTORY_LIMIT }, (_, i) => ({
      id: `r${i}`,
      status: "active",
      effectiveFrom: new Date(Date.UTC(2026, 8, 20, 12, 0, 0, 5) - i * 3_600_000).toISOString(),
      effectiveTo: i === 0 ? null : new Date(Date.UTC(2026, 8, 20, 12, 0, 0, 5) - (i - 1) * 3_600_000).toISOString(),
      recordedByName: null,
      reason: null,
    }));
    expect(presenceSinceSummary(rows, "active").sinceLabel).toMatch(/^Since at least /);
  });
});
