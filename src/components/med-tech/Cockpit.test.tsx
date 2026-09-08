import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Cockpit } from "./Cockpit";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), refresh: vi.fn(),
  state: { userId: "operator", shift: {}, passes: [], residents: [], tape: [], shiftId: "expired-shift", handoffTime: "23:00", loading: false, error: null as string | null },
}));
vi.mock("@/hooks/med-tech/useShiftCurrent", () => ({ useShiftCurrent: () => ({ ...mocks.state, refresh: mocks.refresh }) }));
vi.mock("@/lib/med-tech/shift-commands", () => ({ startMedicationShift: mocks.start }));
vi.mock("./ShiftStart", () => ({ ShiftStart: () => <p>Choose the next medication assignment</p> }));
vi.mock("./ShiftBar", () => ({ ShiftBar: () => null }));
vi.mock("./NowLane", () => ({ NowLane: () => null }));
vi.mock("./ResidentRail", () => ({ ResidentRail: () => null }));
vi.mock("./ShiftTape", () => ({ ShiftTape: () => null }));
vi.mock("./MedPassFlow/MedPassModal", () => ({ MedPassModal: () => null }));
vi.mock("./ResidentDrawer", () => ({ ResidentDrawer: () => null }));
vi.mock("./IncidentModal", () => ({ IncidentModal: () => null }));

it("reloads current assignment selection when generation rejects an expired shift", async () => {
  mocks.start.mockRejectedValue(new Error("This medication assignment is outside its active window"));
  mocks.refresh.mockImplementation(async () => { mocks.state.error = "No active shift"; });
  render(<Cockpit />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh medication queue" }));
  expect(await screen.findByText("Choose the next medication assignment")).toBeInTheDocument();
  expect(mocks.start).toHaveBeenCalledWith("expired-shift");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
