import { describe, expect, it } from "vitest";

import {
  TIMELINE_NO_TIME_COPY,
  TIMELINE_UNKNOWN_DAY_KEY,
  groupTimelineByDay,
  timelineDayKey,
  timelineDayLabel,
  timelineDetailNeedsExpand,
  timelineLinkFor,
  timelineRowKey,
  timelineRowLabel,
  type ResidentTimelineRow,
} from "./timeline";

const TIME_ZONE = "America/New_York";

function row(overrides: Partial<ResidentTimelineRow> = {}): ResidentTimelineRow {
  return {
    care_event_id: null,
    detail: null,
    facility_id: "00000000-0000-4000-8000-0000000000f1",
    incident_id: null,
    kind: "note",
    level: null,
    occurred_at: "2026-09-14T14:00:00.000Z",
    organization_id: "00000000-0000-4000-8000-0000000000a1",
    resident_id: "00000000-0000-4000-8000-0000000000r1",
    source: "daily_log",
    source_id: "00000000-0000-4000-8000-000000000001",
    status: null,
    title: "Shift note",
    ...overrides,
  };
}

describe("groupTimelineByDay", () => {
  it("groups by facility-local day and orders newest first", () => {
    const lateNightUtc = row({ source_id: "a", occurred_at: "2026-09-14T03:30:00.000Z" }); // Sep 13, 11:30 PM in New York
    const morning = row({ source_id: "b", occurred_at: "2026-09-14T12:00:00.000Z" }); // Sep 14, 8:00 AM
    const evening = row({ source_id: "c", occurred_at: "2026-09-14T23:00:00.000Z" }); // Sep 14, 7:00 PM

    const groups = groupTimelineByDay([lateNightUtc, morning, evening], TIME_ZONE);

    expect(groups.map((group) => group.dayKey)).toEqual(["2026-09-14", "2026-09-13"]);
    expect(groups[0].rows.map((entry) => entry.source_id)).toEqual(["c", "b"]);
    expect(groups[1].rows.map((entry) => entry.source_id)).toEqual(["a"]);
    expect(groups[0].dayLabel).toBe("Monday, September 14, 2026");
  });

  it("keeps entries with no time posted in one trailing group", () => {
    const groups = groupTimelineByDay([row({ source_id: "x", occurred_at: null }), row({ source_id: "y" })], TIME_ZONE);

    expect(groups.map((group) => group.dayKey)).toEqual(["2026-09-14", TIMELINE_UNKNOWN_DAY_KEY]);
    expect(groups[1].dayLabel).toBe(TIMELINE_NO_TIME_COPY);
  });

  it("returns no groups for no entries", () => {
    expect(groupTimelineByDay([], TIME_ZONE)).toEqual([]);
  });
});

describe("timelineDayKey and timelineDayLabel", () => {
  it("uses the facility zone for the day boundary", () => {
    expect(timelineDayKey("2026-09-14T03:30:00.000Z", TIME_ZONE)).toBe("2026-09-13");
    expect(timelineDayKey("2026-09-14T03:30:00.000Z", "UTC")).toBe("2026-09-14");
    expect(timelineDayKey("not a date", TIME_ZONE)).toBe(TIMELINE_UNKNOWN_DAY_KEY);
  });

  it("names the gap for an unknown day", () => {
    expect(timelineDayLabel(TIMELINE_UNKNOWN_DAY_KEY)).toBe(TIMELINE_NO_TIME_COPY);
    expect(timelineDayLabel("garbage")).toBe(TIMELINE_NO_TIME_COPY);
  });
});

describe("timelineRowLabel", () => {
  it("uses the tile word and the level word for a care event", () => {
    const label = timelineRowLabel(
      row({ source: "care_event", kind: "fall", level: "level_3", title: "Fall", occurred_at: "2026-09-15T02:05:00.000Z" }),
      TIME_ZONE,
    );

    expect(label.title).toBe("Fall");
    expect(label.sourceWord).toBe("Care event");
    expect(label.levelWord).toBe("Urgent");
    expect(label.timeLabel).toBe("10:05 PM");
  });

  it("uses the tile word even when the view title drifts", () => {
    const label = timelineRowLabel(row({ source: "care_event", kind: "injury_found", title: "Injury found" }), TIME_ZONE);
    expect(label.title).toBe("Hurt");
  });

  it("keeps the view title and no level for other sources", () => {
    const note = timelineRowLabel(row(), TIME_ZONE);
    expect(note.title).toBe("Shift note");
    expect(note.sourceWord).toBe("Shift note");
    expect(note.levelWord).toBeNull();

    const incident = timelineRowLabel(
      row({ source: "incident", kind: "fall_witnessed", title: "Fall Witnessed", level: "level_2" }),
      TIME_ZONE,
    );
    expect(incident.title).toBe("Fall Witnessed");
    expect(incident.sourceWord).toBe("Incident");
    expect(incident.levelWord).toBe("Heads-up");
  });

  it("never lets a raw level code through", () => {
    for (const level of ["level_1", "level_2", "level_3", "level_4"] as const) {
      const label = timelineRowLabel(row({ source: "care_event", kind: "fall", level }), TIME_ZONE);
      expect(label.levelWord).not.toMatch(/level_/);
    }
  });

  it("falls back to the source word when the title is blank", () => {
    expect(timelineRowLabel(row({ title: "  " }), TIME_ZONE).title).toBe("Shift note");
    expect(timelineRowLabel(row({ source: "mystery", title: null }), TIME_ZONE).title).toBe("Entry");
  });

  it("names a missing time", () => {
    expect(timelineRowLabel(row({ occurred_at: null }), TIME_ZONE).timeLabel).toBe(TIMELINE_NO_TIME_COPY);
  });
});

describe("timelineLinkFor", () => {
  const linked = row({
    source: "care_event",
    kind: "fall",
    incident_id: "00000000-0000-4000-8000-0000000000i1",
    care_event_id: "00000000-0000-4000-8000-0000000000c1",
  });

  it("gives the admin the incident and the card", () => {
    expect(timelineLinkFor("admin", linked)).toEqual([
      { label: "Open incident", href: "/admin/incidents/00000000-0000-4000-8000-0000000000i1" },
      { label: "Open card", href: "/admin/care-events/00000000-0000-4000-8000-0000000000c1" },
    ]);
  });

  it("gives the caregiver the receipt only", () => {
    expect(timelineLinkFor("caregiver", linked)).toEqual([
      { label: "Open receipt", href: "/caregiver/report/00000000-0000-4000-8000-0000000000c1" },
    ]);
  });

  it("gives nothing for a shift note", () => {
    expect(timelineLinkFor("admin", row())).toEqual([]);
    expect(timelineLinkFor("caregiver", row())).toEqual([]);
  });
});

describe("row keys and expand control", () => {
  it("keys rows by source and id", () => {
    expect(timelineRowKey(row({ source: "behavior", source_id: "abc" }))).toBe("behavior:abc");
  });

  it("offers the expand control only for long or multi-line detail", () => {
    expect(timelineDetailNeedsExpand(null)).toBe(false);
    expect(timelineDetailNeedsExpand("Short note.")).toBe(false);
    expect(timelineDetailNeedsExpand("Line one.\nLine two.")).toBe(true);
    expect(timelineDetailNeedsExpand("x".repeat(141))).toBe(true);
  });
});
