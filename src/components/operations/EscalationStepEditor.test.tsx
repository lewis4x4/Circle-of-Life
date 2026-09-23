import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EscalationStepEditor } from "@/components/operations/EscalationStepEditor";

describe("EscalationStepEditor (COL-689)", () => {
  const steps = [
    { role: "facility_administrator", channel: "in_app", sla_minutes: "30", enabled: true },
    { role: "coo", channel: "sms", sla_minutes: "120", enabled: true },
  ];

  it("shows each step as labelled fields in staff words", () => {
    render(<EscalationStepEditor steps={steps} onChange={() => {}} />);
    expect(screen.getByLabelText("Step 1 escalates to")).toHaveValue("facility_administrator");
    expect(screen.getAllByRole("option", { name: "Facility administrator" }).length).toBe(2);
    expect(screen.getByLabelText("Step 2 channel")).toHaveValue("sms");
    expect(screen.getAllByRole("option", { name: "Text message" }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Step 2 minutes to wait")).toHaveValue("120");
  });

  it("adds, moves and removes steps", () => {
    const onChange = vi.fn();
    render(<EscalationStepEditor steps={steps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(onChange).toHaveBeenLastCalledWith([...steps, { role: "", channel: "in_app", sla_minutes: "", enabled: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(onChange).toHaveBeenLastCalledWith([steps[1], steps[0]]);
    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(onChange).toHaveBeenLastCalledWith([steps[1]]);
  });

  it("says there is no escalation when the ladder is empty", () => {
    render(<EscalationStepEditor steps={[]} onChange={() => {}} />);
    expect(screen.getByText(/No escalation/)).toBeInTheDocument();
  });
});
