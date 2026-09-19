import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CadenceWindowStrip } from "./CadenceWindowStrip";
import type { CadenceDayShape, CadenceShift, CadenceWindowShape } from "@/lib/rounding/cadence-settings";

const SHIFTS: CadenceShift[] = [
  { shift_key: "day", label: "Day", starts_at_local: "06:00", ends_at_local: "18:00", starts_minute: 360, ends_minute: 1080 },
  { shift_key: "night", label: "Night", starts_at_local: "18:00", ends_at_local: "06:00", starts_minute: 1080, ends_minute: 360 },
];

function win(overrides: Partial<CadenceWindowShape>): CadenceWindowShape {
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

/** The six seeded windows, as `cadence_version_day_shape` returns them. */
function seededShape(overrides: Partial<CadenceDayShape> = {}): CadenceDayShape {
  return {
    cadence_version_id: "cadence-1",
    windows_per_day: 6,
    largest_unobserved_gap_minutes: 180,
    largest_gap_starts_minute: 180,
    largest_gap_ends_minute: 360,
    has_overlap: false,
    windows: [
      win({ window_key: "shift_change_am", label: "Morning shift change check", due_minute: 360, opens_minute: 360, closes_minute: 420, grace_before_minutes: 0 }),
      win({ window_key: "mid_morning" }),
      win({ window_key: "afternoon", label: "Afternoon check", due_minute: 840, opens_minute: 780, closes_minute: 900 }),
      win({ window_key: "shift_change_pm", label: "Night shift change check", shift_key: "night", due_minute: 1080, opens_minute: 1080, closes_minute: 1140, grace_before_minutes: 0 }),
      win({ window_key: "late_evening", label: "Late evening check", shift_key: "night", due_minute: 1320, opens_minute: 1260, closes_minute: 1380 }),
      win({ window_key: "overnight", label: "Overnight check", shift_key: "night", due_minute: 120, opens_minute: 60, closes_minute: 180 }),
    ],
    ...overrides,
  };
}

afterEach(cleanup);

describe("the 24 hour window strip", () => {
  it("names every enabled check with its due time and its grace span", () => {
    render(<CadenceWindowStrip shape={seededShape()} shifts={SHIFTS} label="The day as it runs now" />);

    expect(screen.getByRole("heading", { name: "The day as it runs now" })).toBeInTheDocument();
    expect(screen.getByText("Morning shift change check")).toBeInTheDocument();
    expect(screen.getByText("06:00 (06:00 to 07:00)")).toBeInTheDocument();
    expect(screen.getByText("10:00 (09:00 to 11:00)")).toBeInTheDocument();
    expect(screen.getByText("02:00 (01:00 to 03:00)")).toBeInTheDocument();
  });

  it("labels the largest unobserved span in wall clock terms", () => {
    render(<CadenceWindowStrip shape={seededShape()} shifts={SHIFTS} label="The day as it runs now" />);

    expect(
      screen.getByText(
        "Nobody looks at a resident between 03:00 and 06:00, which is 3 hr.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("6 checks per resident per day, longest unobserved span 3 hr")).toBeInTheDocument();
  });

  it("takes the gap from the row rather than recomputing it from the windows", () => {
    // The strip must not carry its own copy of the gap arithmetic. That answer
    // lives in public.cadence_version_day_shape, because the same answer blocks
    // a change in validate_cadence_version. Feeding a value the windows do not
    // imply proves the row is what renders: a component doing its own sum would
    // print 3 hr here.
    render(
      <CadenceWindowStrip
        shape={seededShape({
          largest_unobserved_gap_minutes: 245,
          largest_gap_starts_minute: 180,
          largest_gap_ends_minute: 425,
        })}
        shifts={SHIFTS}
        label="The day as it runs now"
      />,
    );

    expect(
      screen.getByText("Nobody looks at a resident between 03:00 and 07:05, which is 4 hr 5 min."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/which is 3 hr\./)).not.toBeInTheDocument();
  });

  it("marks an overlapping check in the error tone and says so in words", () => {
    // An overlap is a defect, not a preference: one observation satisfying two
    // windows inflates compliance silently. It reads destructive because
    // validate_cadence_version refuses it outright.
    const { container } = render(
      <CadenceWindowStrip
        shape={seededShape({
          has_overlap: true,
          windows: [
            win({ window_key: "mid_morning", overlaps_window_keys: ["afternoon"] }),
            win({ window_key: "afternoon", label: "Afternoon check", overlaps_window_keys: ["mid_morning"] }),
          ],
          windows_per_day: 2,
        })}
        shifts={SHIFTS}
        label="The day as proposed"
      />,
    );

    expect(screen.getAllByText("overlaps another check")).toHaveLength(2);
    expect(container.querySelectorAll(".bg-destructive\\/25")).toHaveLength(2);
    expect(container.querySelectorAll(".bg-primary\\/20")).toHaveLength(0);
  });

  it("draws a check that does not overlap in the ordinary tone", () => {
    const { container } = render(
      <CadenceWindowStrip shape={seededShape()} shifts={SHIFTS} label="The day as it runs now" />,
    );

    expect(screen.queryByText("overlaps another check")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".bg-primary\\/20")).toHaveLength(6);
    expect(container.querySelectorAll(".bg-destructive\\/25")).toHaveLength(0);
  });

  it("leaves a disabled check off the strip and out of the count", () => {
    render(
      <CadenceWindowStrip
        shape={seededShape({
          windows_per_day: 1,
          windows: [
            win({ window_key: "mid_morning" }),
            win({ window_key: "late_evening", label: "Late evening check", enabled: false, due_minute: 1320, opens_minute: 1260, closes_minute: 1380 }),
          ],
        })}
        shifts={SHIFTS}
        label="The day as proposed"
      />,
    );

    expect(screen.getByText("Mid morning check")).toBeInTheDocument();
    expect(screen.queryByText("Late evening check")).not.toBeInTheDocument();
    expect(screen.getByText("1 checks per resident per day, longest unobserved span 3 hr")).toBeInTheDocument();
  });

  it("marks a shift boundary for every shift the building runs, and no others", () => {
    const { container } = render(
      <CadenceWindowStrip shape={seededShape()} shifts={SHIFTS} label="The day as it runs now" />,
    );
    // Read from facility_shift_definitions, so a building that moves its shift
    // change moves the marker with it.
    expect(container.querySelectorAll('[title="Day shift starts"]')).toHaveLength(1);
    expect(container.querySelectorAll('[title="Night shift starts"]')).toHaveLength(1);
    expect(container.querySelectorAll('[title$="shift starts"]')).toHaveLength(SHIFTS.length);
  });

  it("says nothing about a gap when the shape reports none", () => {
    render(
      <CadenceWindowStrip
        shape={seededShape({ largest_gap_starts_minute: null, largest_gap_ends_minute: null })}
        shifts={SHIFTS}
        label="The day as proposed"
      />,
    );
    expect(screen.queryByText(/Nobody looks at a resident/)).not.toBeInTheDocument();
  });
});
