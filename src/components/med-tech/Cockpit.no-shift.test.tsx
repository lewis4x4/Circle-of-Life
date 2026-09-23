import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/med-tech/useShiftCurrent", () => ({
  useShiftCurrent: () => ({ loading: false, error: "No active shift", passes: [], residents: [], tape: [], shift: {}, refresh: vi.fn() }),
}));

import { Cockpit } from "./Cockpit";

it("points a med-tech with no open shift at the floor app's time clock, not at a scheduling system (COL-661 A7)", () => {
  render(<Cockpit />);
  expect(screen.getByRole("link", { name: "Time clock" })).toHaveAttribute("href", "/caregiver/clock");
  expect(screen.getByRole("link", { name: "Medications" })).toHaveAttribute("href", "/caregiver/meds");
  expect(screen.queryByText(/scheduling system/)).toBeNull();
});
