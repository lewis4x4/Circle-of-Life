import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CadenceLadderList } from "./CadenceLadderList";
import type { CadenceDayShape, LadderRung } from "@/lib/rounding/cadence-settings";

/** The seeded cadence reduced to the window the ladder is read against. */
const SHAPE: CadenceDayShape = {
  cadence_version_id: "cadence-1",
  windows_per_day: 1,
  largest_unobserved_gap_minutes: 1380,
  largest_gap_starts_minute: 660,
  largest_gap_ends_minute: 2040,
  has_overlap: false,
  windows: [
    {
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
    },
  ],
};

function rung(overrides: Partial<LadderRung>): LadderRung {
  return {
    rung_key: "tier_1",
    label: "First escalation",
    offset_minutes: 30,
    is_terminal: false,
    assigned_staff_only: false,
    include_assigned_staff: true,
    use_standing_alert_routes: false,
    channels: ["in_app", "push"],
    enabled: true,
    standing_alert_route_count: 2,
    roles: [{ staff_role: "administrator", holder_count: 1 }],
    ...overrides,
  };
}

afterEach(cleanup);

describe("the escalation ladder", () => {
  it("reads each step against a real window in wall clock terms", () => {
    // The seeded ladder is stored as offsets from window close. An
    // administrator does not think in offsets, so the step is also shown at the
    // clock time it fires for one named window.
    render(
      <CadenceLadderList
        ladder={[
          rung({ rung_key: "nudge", label: "Staff nudge", offset_minutes: -15, assigned_staff_only: true, roles: [], channels: ["push"] }),
          rung({}),
          rung({ rung_key: "tier_3", label: "Final escalation", offset_minutes: 90, is_terminal: true, channels: ["in_app", "push", "sms"] }),
        ]}
        shape={SHAPE}
        label="What happens when a check does not"
      />,
    );

    expect(screen.getByText("Shown against the mid morning check, which closes at 11:00")).toBeInTheDocument();
    expect(screen.getByText("10:45")).toBeInTheDocument();
    expect(screen.getByText("15 min before the window closes")).toBeInTheDocument();
    expect(screen.getByText("11:30")).toBeInTheDocument();
    expect(screen.getByText("30 min after the window closes")).toBeInTheDocument();
    expect(screen.getByText("12:30")).toBeInTheDocument();
    expect(screen.getByText("1 hr 30 min after the window closes")).toBeInTheDocument();
  });

  it("says the nudge is a reminder and not an escalation", () => {
    // The nudge writes no escalation row. Reading it as one would inflate every
    // escalation count on every surface.
    render(
      <CadenceLadderList
        ladder={[rung({ rung_key: "nudge", label: "Staff nudge", offset_minutes: -15, assigned_staff_only: true, roles: [], channels: ["push"] })]}
        shape={SHAPE}
        label="The ladder"
      />,
    );
    expect(screen.getByText("staff reminder, not an escalation")).toBeInTheDocument();
  });

  it("marks the final step as final", () => {
    render(
      <CadenceLadderList
        ladder={[rung({ rung_key: "tier_3", label: "Final escalation", offset_minutes: 90, is_terminal: true })]}
        shape={SHAPE}
        label="The ladder"
      />,
    );
    expect(screen.getByText("final step")).toBeInTheDocument();
  });

  it("shows a role with nobody in it in the warning tone rather than hiding it", () => {
    // Spec 6.5's third warning. A step addressed to a role nobody holds reaches
    // nobody, and hiding the count is how a ladder looks like it works and does
    // not.
    render(
      <CadenceLadderList
        ladder={[
          rung({
            roles: [
              { staff_role: "administrator", holder_count: 2 },
              { staff_role: "assistant_administrator", holder_count: 0 },
            ],
          }),
        ]}
        shape={SHAPE}
        label="The ladder"
      />,
    );

    const held = screen.getByText("Administrator (2)");
    const unheld = screen.getByText("Assistant administrator (0)");
    expect(held).toBeInTheDocument();
    expect(unheld).toBeInTheDocument();
    expect(unheld.className).toContain("text-warning");
    expect(held.className).not.toContain("text-warning");
  });

  it("names the assigned staff member and the standing audience as recipients in their own right", () => {
    render(
      <CadenceLadderList
        ladder={[rung({ include_assigned_staff: true, use_standing_alert_routes: true })]}
        shape={SHAPE}
        label="The ladder"
      />,
    );
    expect(screen.getByText("the staff member the check belongs to")).toBeInTheDocument();
    expect(screen.getByText("standing alert audience (2)")).toBeInTheDocument();
  });

  it("names the channels in operator words rather than stored values", () => {
    render(
      <CadenceLadderList
        ladder={[rung({ channels: ["in_app", "push", "sms"] })]}
        shape={SHAPE}
        label="The ladder"
      />,
    );
    expect(screen.getByText("In app, Push, Text message")).toBeInTheDocument();
    expect(screen.queryByText(/in_app/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bsms\b/)).not.toBeInTheDocument();
  });

  it("says a step is turned off rather than dropping it from the ladder", () => {
    render(
      <CadenceLadderList ladder={[rung({ enabled: false })]} shape={SHAPE} label="The ladder" />,
    );
    expect(screen.getByText("turned off")).toBeInTheDocument();
  });

  it("offers a test send and an edit per step, and calls back with the step that was picked", () => {
    const onEdit = vi.fn();
    const onTestSend = vi.fn();
    render(
      <CadenceLadderList
        ladder={[rung({ rung_key: "tier_2", label: "Second escalation", offset_minutes: 60 })]}
        shape={SHAPE}
        label="The ladder"
        onEdit={onEdit}
        onTestSend={onTestSend}
      />,
    );

    const row = screen.getByRole("row", { name: /Second escalation/ });
    within(row).getByRole("button", { name: "Test send" }).click();
    within(row).getByRole("button", { name: "Edit" }).click();
    expect(onTestSend).toHaveBeenCalledWith("tier_2");
    expect(onEdit).toHaveBeenCalledWith("tier_2");
  });

  it("falls back to the offset in words when the building has no schedule to read against", () => {
    render(<CadenceLadderList ladder={[rung({})]} shape={null} label="The ladder" />);
    expect(screen.getByText("30 min after the window closes")).toBeInTheDocument();
    expect(screen.queryByText("11:30")).not.toBeInTheDocument();
  });
});
