import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StaffActions } from "./StaffActions";
import type { KioskIdentifyResponse } from "@/lib/timeclock/kiosk-contract";
const base: KioskIdentifyResponse = { first_name: "Example", state: "out", next_actions: ["in"], today_worked_minutes: 0 };
const props = { offline: false, time: "2:00 p.m.", timeZone: "America/New_York", busy: false, onStartOver: vi.fn() };
describe("kiosk plan context leaves actual attendance actions intact", () => {
  it("offers clock in even when the plan lookup fails", () => {
    const onPunch = vi.fn();
    render(<StaffActions {...props} onPunch={onPunch} identified={{ ...base, planned_context: { status: "unavailable" } }} />);
    expect(screen.getByText(/Schedule context is unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    expect(onPunch).toHaveBeenCalledWith("in");
  });
  it("shows all split blocks and preserves clock-out/meal choices", () => {
    const onPunch = vi.fn();
    render(<StaffActions {...props} onPunch={onPunch} identified={{ ...base, state: "in", next_actions: ["out", "meal_start"], planned_context: { status: "ready", blocks: [0, 1].map((index) => ({ label: "Kitchen split", color: "#228866", starts_at: index ? "2026-09-24T20:00:00Z" : "2026-09-24T10:00:00Z", ends_at: index ? "2026-09-24T22:00:00Z" : "2026-09-24T17:00:00Z", time_zone: "America/New_York", block_index: index, block_count: 2 })) } }} />);
    expect(screen.getByText(/block 1 of 2/)).toBeInTheDocument(); expect(screen.getByText(/block 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/gaps are not deducted automatically/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clock out" })); expect(onPunch).toHaveBeenCalledWith("out");
    expect(screen.getByRole("button", { name: "Start meal" })).toBeEnabled();
  });
  it("a successfully empty plan permits unscheduled attendance", () => {
    render(<StaffActions {...props} onPunch={vi.fn()} identified={{ ...base, planned_context: { status: "ready", blocks: [] } }} />);
    expect(screen.getByText(/No published work block was found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock in" })).toBeEnabled();
  });
});
