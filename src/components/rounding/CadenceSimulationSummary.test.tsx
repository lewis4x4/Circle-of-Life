import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CadenceSimulationSummary } from "./CadenceSimulationSummary";
import { SIMULATION_HONESTY_LINE } from "@/lib/rounding/cadence-settings-copy";
import type { SimulationResult } from "@/lib/rounding/cadence-settings";

/** The numbers the acceptance script produced, so the shape is a real one. */
const SIMULATION: SimulationResult = {
  lookback_days: 14,
  from_service_date: "2026-09-04",
  to_service_date: "2026-09-17",
  is_measurement_not_forecast: true,
  measurement_note:
    "This replays the proposed schedule against the observations staff actually recorded.",
  recorded: { expected: 168, satisfied: 32, missed: 136, unconfigured: 0, escalations: 0 },
  in_force: {
    windows_generated: 168,
    would_be_satisfied: 32,
    would_be_missed: 136,
    missed_by_shift: [
      { shift_key: "day", missed: 68 },
      { shift_key: "night", missed: 68 },
    ],
    escalations_by_rung: [
      { rung_key: "tier_1", label: "First escalation", fired: 136 },
      { rung_key: "tier_2", label: "Second escalation", fired: 136 },
      { rung_key: "tier_3", label: "Final escalation", fired: 136 },
    ],
    escalations_total: 408,
    nudges_total: 152,
  },
  proposed: {
    windows_generated: 168,
    would_be_satisfied: 16,
    would_be_missed: 152,
    missed_by_shift: [
      { shift_key: "day", missed: 84 },
      { shift_key: "night", missed: 68 },
    ],
    escalations_by_rung: [
      { rung_key: "tier_1", label: "First escalation", fired: 152 },
      { rung_key: "tier_2", label: "Second escalation", fired: 152 },
      { rung_key: "tier_3", label: "Final escalation", fired: 152 },
    ],
    escalations_total: 456,
    nudges_total: 168,
  },
  change: { missed_delta: 16, windows_delta: 0, escalations_delta: 48, nudges_delta: 16 },
};

afterEach(cleanup);

describe("the simulation summary", () => {
  /**
   * Spec 6.7 requires the surface to say in one line that the replay measures
   * past behavior and is not a forecast. This assertion exists so deleting that
   * sentence fails a test rather than shipping a schedule change presented as a
   * prediction.
   */
  it("carries the measurement, not a forecast, line before any result exists", () => {
    render(<CadenceSimulationSummary simulation={null} onSimulate={vi.fn()} busy={false} />);
    expect(screen.getByText(SIMULATION_HONESTY_LINE)).toBeInTheDocument();
    expect(SIMULATION_HONESTY_LINE).toContain("measurement of the past and not a forecast");
  });

  it("keeps the line on screen once the numbers are there", () => {
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);
    expect(screen.getByText(SIMULATION_HONESTY_LINE)).toBeInTheDocument();
  });

  it("reports both configurations side by side on every line", () => {
    // A single column of numbers reads as a forecast. The configuration in
    // force beside it is what makes it a comparison.
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);

    expect(screen.getByText("168 (168 under the schedule in force)")).toBeInTheDocument();
    expect(screen.getByText("16 (32 under the schedule in force)")).toBeInTheDocument();
    expect(screen.getByText("152 (136 under the schedule in force)")).toBeInTheDocument();
    expect(screen.getByText("456 (408 under the schedule in force)")).toBeInTheDocument();
  });

  it("breaks missed checks down by shift", () => {
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);
    expect(screen.getByText("Missed on the day shift")).toBeInTheDocument();
    expect(screen.getByText("84")).toBeInTheDocument();
    expect(screen.getByText("Missed on the night shift")).toBeInTheDocument();
  });

  it("reports every rung by name", () => {
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);
    expect(screen.getByText("First escalation would have fired")).toBeInTheDocument();
    expect(screen.getByText("Second escalation would have fired")).toBeInTheDocument();
    expect(screen.getByText("Final escalation would have fired")).toBeInTheDocument();
  });

  it("counts staff reminders separately and says they are not escalations", () => {
    // The nudge is not an escalation. Folding it into the escalation total is
    // how a shift full of reminders reads as a building in trouble.
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);
    expect(screen.getByText("Staff reminders, which are not escalations")).toBeInTheDocument();
    expect(screen.getByText("168 (152 under the schedule in force)")).toBeInTheDocument();
  });

  it("names what was actually recorded beside what would have happened", () => {
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);
    expect(screen.getByText("What was actually recorded over the same days")).toBeInTheDocument();
    expect(screen.getByText("32 of 168 met, 0 escalations")).toBeInTheDocument();
  });

  it("names the span it measured, so the numbers cannot be read as all time", () => {
    render(<CadenceSimulationSummary simulation={SIMULATION} onSimulate={vi.fn()} busy={false} />);
    expect(
      screen.getByText("Measured over 14 days, 2026-09-04 to 2026-09-17."),
    ).toBeInTheDocument();
  });

  it("runs the replay on request and does nothing while one is in flight", () => {
    const onSimulate = vi.fn();
    const { rerender } = render(
      <CadenceSimulationSummary simulation={null} onSimulate={onSimulate} busy={false} />,
    );
    screen.getByRole("button", { name: "Simulate" }).click();
    expect(onSimulate).toHaveBeenCalledTimes(1);

    rerender(<CadenceSimulationSummary simulation={null} onSimulate={onSimulate} busy />);
    expect(screen.getByRole("button", { name: "Simulate" })).toBeDisabled();
  });
});
