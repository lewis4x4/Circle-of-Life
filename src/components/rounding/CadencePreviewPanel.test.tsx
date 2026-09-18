import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CadencePreviewPanel } from "./CadencePreviewPanel";
import type {
  CadenceDayShape,
  CadenceValidation,
  ObservationConfigOverview,
} from "@/lib/rounding/cadence-settings";

function shape(overrides: Partial<CadenceDayShape> = {}): CadenceDayShape {
  return {
    cadence_version_id: "cadence-1",
    windows_per_day: 6,
    largest_unobserved_gap_minutes: 180,
    largest_gap_starts_minute: 180,
    largest_gap_ends_minute: 360,
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
    ...overrides,
  };
}

function overview(validation: CadenceValidation): ObservationConfigOverview {
  return {
    facility_id: "facility-1",
    facility_name: "A Building",
    timezone: "America/New_York",
    active_resident_count: 33,
    shifts: [
      { shift_key: "day", label: "Day", starts_at_local: "06:00", ends_at_local: "18:00", starts_minute: 360, ends_minute: 1080 },
      { shift_key: "night", label: "Night", starts_at_local: "18:00", ends_at_local: "06:00", starts_minute: 1080, ends_minute: 360 },
    ],
    cadence_template_id: null,
    cadence_template_name: null,
    escalation_template_id: null,
    escalation_template_name: null,
    jurisdiction_floor: null,
    thresholds: {
      maximum_unobserved_gap_minutes: 180,
      maximum_windows_per_resident_per_day: 8,
      simulation_lookback_days: 14,
      change_log_page_size: 10,
    },
    current: {
      cadence_version_id: "cadence-1",
      cadence_version_number: 1,
      cadence_effective_from: "2026-09-16T04:00:00.000Z",
      cadence_change_reason: "Seeded.",
      escalation_version_id: "escalation-1",
      day_shape: shape(),
      daily_task_total: 198,
      ladder: [],
    },
    proposed: {
      cadence_version_id: "cadence-2",
      escalation_version_id: null,
      day_shape: shape({ cadence_version_id: "cadence-2", windows_per_day: 5, largest_unobserved_gap_minutes: 300 }),
      daily_task_total: 165,
      ladder: [],
      validation,
    },
    next_shift_boundary_at: "2026-09-18T22:00:00.000Z",
  };
}

function clean(): CadenceValidation {
  return {
    ok: true,
    windows_per_day: 5,
    current_windows_per_day: 6,
    largest_unobserved_gap_minutes: 300,
    blocks: [],
    warnings: [],
  };
}

function props(validation: CadenceValidation, overrides: Record<string, unknown> = {}) {
  return {
    overview: overview(validation),
    simulation: null,
    activationReason: "Signed off this morning.",
    onActivationReasonChange: vi.fn(),
    applyMode: "next_shift_boundary" as const,
    onApplyModeChange: vi.fn(),
    scheduledFor: "",
    onScheduledForChange: vi.fn(),
    acknowledgment: "",
    onAcknowledgmentChange: vi.fn(),
    onSimulate: vi.fn(),
    onCommit: vi.fn(),
    onDiscard: vi.fn(),
    busy: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("the preview before commit", () => {
  it("shows current against proposed for the three numbers that matter", () => {
    render(<CadencePreviewPanel {...props(clean())} />);

    expect(screen.getByRole("article", { name: "Checks per resident per day: 5" })).toBeInTheDocument();
    expect(screen.getByText("Now 6")).toBeInTheDocument();
    // The daily total is computed from the live active resident count, not from
    // a number typed into the spec.
    expect(screen.getByRole("article", { name: "Checks a day across the building: 165" })).toBeInTheDocument();
    expect(screen.getByText("33 residents in the building right now")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Longest unobserved span: 5 hr" })).toBeInTheDocument();
    expect(screen.getByText("Now 3 hr")).toBeInTheDocument();
  });

  it("draws both days, the one that runs now and the one proposed", () => {
    render(<CadencePreviewPanel {...props(clean())} />);
    expect(screen.getByRole("heading", { name: "The day as it runs now" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The day as proposed" })).toBeInTheDocument();
  });

  it("lists every hard block in its own words and refuses to commit", () => {
    // The blocks are refused in the database. They are listed here so an
    // administrator reads them before submitting, not instead of.
    const blocked: CadenceValidation = {
      ...clean(),
      ok: false,
      blocks: [
        {
          code: "overlapping_grace_spans",
          message:
            "Two enabled windows overlap. afternoon and mid_morning share time, so one observation would satisfy both windows and silently inflate compliance.",
        },
        {
          code: "shift_without_window",
          message: "The Night shift has no enabled observation window. Every defined shift must carry at least one check.",
        },
      ],
    };
    render(<CadencePreviewPanel {...props(blocked)} />);

    expect(screen.getByText("This change cannot go in force yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Two enabled windows overlap. afternoon and mid_morning share time, so one observation would satisfy both windows and silently inflate compliance.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The Night shift has no enabled observation window. Every defined shift must carry at least one check.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule this change" })).toBeDisabled();
  });

  it("lists a warning without refusing, and asks for the building name", () => {
    // A warning is a judgment call an administrator is allowed to make. It costs
    // a typed acknowledgment rather than a refusal.
    const warned: CadenceValidation = {
      ...clean(),
      warnings: [
        {
          code: "windows_per_day_decreased",
          message: "Checks per resident per day fall from 6 to 5.",
          requires_acknowledgment: true,
        },
      ],
    };
    render(<CadencePreviewPanel {...props(warned)} />);

    expect(screen.getByText("Worth a second look before you confirm")).toBeInTheDocument();
    expect(screen.getByText("Checks per resident per day fall from 6 to 5.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm by typing A Building/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule this change" })).toBeEnabled();
  });

  it("asks for no acknowledgment on a clean change at the next shift boundary", () => {
    render(<CadencePreviewPanel {...props(clean())} />);
    expect(screen.queryByLabelText(/Confirm by typing/)).not.toBeInTheDocument();
    expect(screen.getByText("The next boundary is " + new Date("2026-09-18T22:00:00.000Z").toLocaleString() + ".")).toBeInTheDocument();
  });

  it("always asks for an acknowledgment on an immediate apply", () => {
    render(<CadencePreviewPanel {...props(clean(), { applyMode: "immediate" })} />);
    expect(screen.getByLabelText(/Confirm by typing A Building/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Put in force now" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pending checks past this moment are cancelled and rebuilt on the new schedule. A completed check, a missed check and an escalation that already fired are never touched.",
      ),
    ).toBeInTheDocument();
  });

  it("asks for a date only when the change is being scheduled", () => {
    const { rerender } = render(<CadencePreviewPanel {...props(clean())} />);
    expect(screen.queryByText("Date and time")).not.toBeInTheDocument();
    rerender(<CadencePreviewPanel {...props(clean(), { applyMode: "scheduled" })} />);
    expect(screen.getByText("Date and time")).toBeInTheDocument();
  });

  it("refuses to commit without a reason, because the reason is the record", () => {
    render(<CadencePreviewPanel {...props(clean(), { activationReason: "   " })} />);
    expect(screen.getByRole("button", { name: "Schedule this change" })).toBeDisabled();
  });

  it("offers to leave the change as a proposal rather than forcing a decision", () => {
    const onDiscard = vi.fn();
    render(<CadencePreviewPanel {...props(clean(), { onDiscard })} />);
    screen.getByRole("button", { name: "Leave it as a proposal" }).click();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("renders nothing at all when there is no proposal to preview", () => {
    const base = props(clean());
    const { container } = render(
      <CadencePreviewPanel {...base} overview={{ ...base.overview, proposed: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
