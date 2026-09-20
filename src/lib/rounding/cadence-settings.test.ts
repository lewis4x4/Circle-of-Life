import { describe, expect, it } from "vitest";

import {
  APPLY_MODES,
  APPLY_MODE_LABELS,
  draftsDiffer,
  formatMinuteOfDay,
  formatOffsetFromClose,
  formatSpanMinutes,
  joinLocalTime,
  rungDraftsFrom,
  rungFireMinute,
  splitLocalTime,
  stripPercent,
  stripSegments,
  windowDraftsFrom,
  type CadenceDayShape,
  type CadenceWindowShape,
  type LadderRung,
} from "./cadence-settings";

/**
 * Where the window geometry actually lives, so this file is read for what it is.
 *
 * Grace span overlap detection and the largest unobserved gap are computed in
 * `public.cadence_version_day_shape` and nowhere else. That is deliberate: the
 * same answer blocks a change in `validate_cadence_version`, and a second copy
 * in TypeScript would be a second place for it to disagree with the validation.
 * `scripts/smart-rounding/config-invariants-acceptance.sql` is what proves that
 * arithmetic, and migration 425 derives the seeded 03:00 to 06:00 gap from the
 * rows rather than asserting it.
 *
 * What this file covers is the arithmetic that does live here: turning the
 * minute counts the database returns into positions on a strip and sentences a
 * person reads. Every case below is an exact comparison. A helper that wraps
 * midnight is the one most likely to be quietly wrong and the least likely to
 * be caught by a SQL probe.
 */

function windowShape(overrides: Partial<CadenceWindowShape>): CadenceWindowShape {
  return {
    window_key: "mid_morning",
    label: "Mid morning check",
    shift_key: "day",
    enabled: true,
    due_minute: 600,
    opens_minute: 540,
    closes_minute: 660,
    grace_before_minutes: 60,
    grace_after_minutes: 60,
    overlaps_window_keys: [],
    ...overrides,
  };
}

describe("formatMinuteOfDay", () => {
  it("renders a minute count as a zero padded local wall time", () => {
    expect(formatMinuteOfDay(0)).toBe("00:00");
    expect(formatMinuteOfDay(360)).toBe("06:00");
    expect(formatMinuteOfDay(600)).toBe("10:00");
    expect(formatMinuteOfDay(1319)).toBe("21:59");
  });

  it("wraps a count past the end of the day back onto the clock", () => {
    expect(formatMinuteOfDay(1440)).toBe("00:00");
    expect(formatMinuteOfDay(1500)).toBe("01:00");
    expect(formatMinuteOfDay(2880)).toBe("00:00");
  });

  it("wraps a count before the start of the day onto the previous evening", () => {
    // A window opening an hour before midnight arrives here as -60, which is
    // what a grace span that crosses midnight looks like.
    expect(formatMinuteOfDay(-60)).toBe("23:00");
    expect(formatMinuteOfDay(-1)).toBe("23:59");
    expect(formatMinuteOfDay(-1440)).toBe("00:00");
  });
});

describe("formatSpanMinutes", () => {
  it("reads in minutes below an hour and in hours above one", () => {
    expect(formatSpanMinutes(0)).toBe("0 min");
    expect(formatSpanMinutes(10)).toBe("10 min");
    expect(formatSpanMinutes(59)).toBe("59 min");
    expect(formatSpanMinutes(60)).toBe("1 hr");
    expect(formatSpanMinutes(90)).toBe("1 hr 30 min");
    // The gap the seeded six windows leave between the overnight check and the
    // morning shift change, as the strip labels it.
    expect(formatSpanMinutes(180)).toBe("3 hr");
  });

  it("never reads as a negative span", () => {
    expect(formatSpanMinutes(-30)).toBe("0 min");
  });
});

describe("formatOffsetFromClose", () => {
  it("names the direction rather than showing a sign", () => {
    expect(formatOffsetFromClose(0)).toBe("at the moment the window closes");
    expect(formatOffsetFromClose(-15)).toBe("15 min before the window closes");
    expect(formatOffsetFromClose(30)).toBe("30 min after the window closes");
    expect(formatOffsetFromClose(90)).toBe("1 hr 30 min after the window closes");
  });
});

describe("rungFireMinute", () => {
  it("reads a step against one window's close in wall clock terms", () => {
    // A check whose window shuts at 11:00 and a step 30 minutes after it.
    expect(formatMinuteOfDay(rungFireMinute(660, 30))).toBe("11:30");
    expect(formatMinuteOfDay(rungFireMinute(660, -15))).toBe("10:45");
  });

  it("wraps a step that fires on the other side of midnight", () => {
    // The overnight check shuts at 03:00; a step 90 minutes before it fires the
    // previous day, and a step measured off a 23:30 close fires after midnight.
    expect(formatMinuteOfDay(rungFireMinute(180, -240))).toBe("23:00");
    expect(formatMinuteOfDay(rungFireMinute(1410, 90))).toBe("01:00");
  });
});

describe("stripPercent", () => {
  it("places a minute on the 24 hour strip", () => {
    expect(stripPercent(0)).toBe(0);
    expect(stripPercent(360)).toBe(25);
    expect(stripPercent(720)).toBe(50);
    expect(stripPercent(1080)).toBe(75);
  });

  it("wraps rather than running off either end of the strip", () => {
    expect(stripPercent(1440)).toBe(0);
    expect(stripPercent(-360)).toBe(75);
  });
});

describe("stripSegments", () => {
  it("draws a window that sits inside one day as a single segment", () => {
    expect(stripSegments(windowShape({}))).toEqual([
      { leftPercent: 37.5, widthPercent: (120 / 1440) * 100 },
    ]);
  });

  it("draws the one sided shift change window from its due time, not before it", () => {
    // grace_before 0 is a requirement rather than a preference: the incoming
    // shift has to be the one that lays eyes on the resident. The segment has
    // to start at the due time, so an early opening is visible as one.
    const segments = stripSegments(
      windowShape({
        window_key: "shift_change_am",
        due_minute: 360,
        opens_minute: 360,
        closes_minute: 420,
        grace_before_minutes: 0,
      }),
    );
    expect(segments).toEqual([{ leftPercent: 25, widthPercent: (60 / 1440) * 100 }]);
  });

  it("splits a span whose grace runs past midnight into two segments", () => {
    const segments = stripSegments(
      windowShape({ window_key: "late_night", due_minute: 1410, opens_minute: 1410, closes_minute: 1470 }),
    );
    expect(segments).toEqual([
      { leftPercent: (1410 / 1440) * 100, widthPercent: (30 / 1440) * 100 },
      { leftPercent: 0, widthPercent: (30 / 1440) * 100 },
    ]);
    // The two pieces add up to the whole span and neither runs off the strip.
    expect(segments[0].widthPercent + segments[1].widthPercent).toBeCloseTo((60 / 1440) * 100, 10);
  });

  it("splits a span that opens before midnight into two segments", () => {
    const segments = stripSegments(
      windowShape({ window_key: "just_after_midnight", due_minute: 15, opens_minute: -45, closes_minute: 75 }),
    );
    expect(segments).toEqual([
      { leftPercent: (1395 / 1440) * 100, widthPercent: (45 / 1440) * 100 },
      { leftPercent: 0, widthPercent: (75 / 1440) * 100 },
    ]);
  });

  it("draws nothing for a window with no span at all", () => {
    expect(
      stripSegments(
        windowShape({ due_minute: 600, opens_minute: 600, closes_minute: 600, grace_before_minutes: 0, grace_after_minutes: 0 }),
      ),
    ).toEqual([]);
  });

  it("draws every one of the six seeded windows without wrapping any of them", () => {
    // The seeded cadence, as minutes: 06:00 with no early opening, then four
    // windows with an hour either side, and the 02:00 overnight check which sits
    // well clear of midnight. None of them should split.
    const seeded: Array<[number, number, number]> = [
      [360, 360, 420],
      [600, 540, 660],
      [840, 780, 900],
      [1080, 1080, 1140],
      [1320, 1260, 1380],
      [120, 60, 180],
    ];
    for (const [due, opens, closes] of seeded) {
      expect(
        stripSegments(windowShape({ due_minute: due, opens_minute: opens, closes_minute: closes })),
      ).toHaveLength(1);
    }
  });
});

describe("splitLocalTime and joinLocalTime", () => {
  it("round trips a stored local time through the two numeric fields", () => {
    expect(splitLocalTime("10:00")).toEqual({ hour: 10, minute: 0 });
    expect(splitLocalTime("02:30")).toEqual({ hour: 2, minute: 30 });
    expect(joinLocalTime(6, 0)).toBe("06:00");
    expect(joinLocalTime(22, 5)).toBe("22:05");
    expect(joinLocalTime(splitLocalTime("18:45").hour, splitLocalTime("18:45").minute)).toBe("18:45");
  });

  it("reads a malformed value as midnight rather than as not a number", () => {
    // A field mid edit can be empty. Midnight is wrong but renderable; NaN would
    // put "NaN:NaN" into the payload and the command would refuse it with a cast
    // error rather than a sentence.
    expect(splitLocalTime("")).toEqual({ hour: 0, minute: 0 });
    expect(splitLocalTime("nonsense")).toEqual({ hour: 0, minute: 0 });
  });
});

describe("windowDraftsFrom", () => {
  const shape: CadenceDayShape = {
    cadence_version_id: "cadence-1",
    windows_per_day: 2,
    largest_unobserved_gap_minutes: 180,
    largest_gap_starts_minute: 180,
    largest_gap_ends_minute: 360,
    has_overlap: false,
    windows: [
      windowShape({ window_key: "shift_change_am", label: "Morning shift change check", due_minute: 360, opens_minute: 360, closes_minute: 420, grace_before_minutes: 0 }),
      windowShape({ window_key: "late_evening", label: "Late evening check", shift_key: "night", due_minute: 1320, opens_minute: 1260, closes_minute: 1380, enabled: false }),
    ],
  };

  it("turns the rows in force into the payload the command takes", () => {
    expect(windowDraftsFrom(shape)).toEqual([
      {
        window_key: "shift_change_am",
        label: "Morning shift change check",
        due_at_local: "06:00",
        grace_before_minutes: 0,
        grace_after_minutes: 60,
        shift_key: "day",
        sort_order: 0,
        enabled: true,
      },
      {
        window_key: "late_evening",
        label: "Late evening check",
        due_at_local: "22:00",
        grace_before_minutes: 60,
        grace_after_minutes: 60,
        shift_key: "night",
        sort_order: 1,
        enabled: false,
      },
    ]);
  });

  it("answers with nothing when the building has no schedule in force", () => {
    expect(windowDraftsFrom(null)).toEqual([]);
  });
});

describe("rungDraftsFrom", () => {
  const ladder: LadderRung[] = [
    {
      rung_key: "nudge",
      label: "Staff nudge",
      offset_minutes: -15,
      is_terminal: false,
      assigned_staff_only: true,
      include_assigned_staff: true,
      use_standing_alert_routes: false,
      channels: ["push"],
      enabled: true,
      standing_alert_route_count: 1,
      roles: [],
    },
    {
      rung_key: "tier_3",
      label: "Final escalation",
      offset_minutes: 90,
      is_terminal: true,
      assigned_staff_only: false,
      include_assigned_staff: false,
      use_standing_alert_routes: true,
      channels: ["in_app", "push", "sms"],
      enabled: true,
      standing_alert_route_count: 1,
      roles: [
        { staff_role: "administrator", holder_count: 1 },
        { staff_role: "assistant_administrator", holder_count: 0 },
      ],
    },
  ];

  it("turns the ladder in force into the payload the command takes", () => {
    expect(rungDraftsFrom(ladder)).toEqual([
      {
        rung_key: "nudge",
        label: "Staff nudge",
        offset_minutes: -15,
        is_terminal: false,
        assigned_staff_only: true,
        include_assigned_staff: true,
        use_standing_alert_routes: false,
        target_staff_roles: [],
        channels: ["push"],
        protocol_text: null,
        sort_order: 0,
        enabled: true,
      },
      {
        rung_key: "tier_3",
        label: "Final escalation",
        offset_minutes: 90,
        is_terminal: true,
        assigned_staff_only: false,
        include_assigned_staff: false,
        use_standing_alert_routes: true,
        target_staff_roles: ["administrator", "assistant_administrator"],
        channels: ["in_app", "push", "sms"],
        protocol_text: null,
        sort_order: 1,
        enabled: true,
      },
    ]);
  });

  it("preserves terminal instructions and shift overrides while editing an unrelated field", () => {
    const policy = { ...ladder[1], sort_order: 7, protocol_text: "Call the on-call lead", shift_overrides: [{ shift_key: "night", offset_minutes: 120, channels: ["in_app"] }] };
    expect(rungDraftsFrom([policy])[0]).toMatchObject({ sort_order: 7, protocol_text: policy.protocol_text, shift_overrides: policy.shift_overrides });
  });

  it("carries a role with nobody in it through to the payload", () => {
    // Dropping an unheld role here would silently rewrite the ladder while the
    // administrator was editing something else. The zero holder case is a
    // warning on the preview, not a quiet deletion.
    expect(rungDraftsFrom(ladder)[1].target_staff_roles).toContain("assistant_administrator");
  });
});

describe("draftsDiffer", () => {
  const original = windowDraftsFrom({
    cadence_version_id: "cadence-1",
    windows_per_day: 1,
    largest_unobserved_gap_minutes: 1380,
    largest_gap_starts_minute: 660,
    largest_gap_ends_minute: 2040,
    has_overlap: false,
    windows: [windowShape({})],
  });

  it("reads an untouched draft as unchanged", () => {
    expect(draftsDiffer(original, original)).toBe(false);
    expect(draftsDiffer([...original], original)).toBe(false);
  });

  it("reads a moved due time, a changed grace and a disabled window as changed", () => {
    expect(draftsDiffer([{ ...original[0], due_at_local: "11:00" }], original)).toBe(true);
    expect(draftsDiffer([{ ...original[0], grace_before_minutes: 0 }], original)).toBe(true);
    expect(draftsDiffer([{ ...original[0], enabled: false }], original)).toBe(true);
  });

  it("reads a reordered list as changed, because sort order is the order staff see", () => {
    const two = [original[0], { ...original[0], window_key: "afternoon" }];
    expect(draftsDiffer([two[1], two[0]], two)).toBe(true);
  });
});

describe("the effective timing options", () => {
  it("offers the three options spec 6.4 names, with the boundary default first", () => {
    expect(APPLY_MODES).toEqual(["next_shift_boundary", "scheduled", "immediate"]);
    expect(APPLY_MODE_LABELS.next_shift_boundary).toBe("At the next shift boundary");
    expect(APPLY_MODE_LABELS.immediate).toBe("Immediately");
  });
});
