import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeBedAction } from "./ChangeBedAction";

const mocks = vi.hoisted(() => ({ role: "nurse", load: vi.fn(), rpc: vi.fn(), success: vi.fn() }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: mocks.role, loading: false }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/residents/bed-move", async (original) => ({ ...await original<typeof import("@/lib/residents/bed-move")>(), loadBedMoveSnapshot: mocks.load }));
const snapshot = { facilityName: "Test facility", currentBedId: "old", currentBedLabel: "Room 101 · Bed A", options: [
  { id: "old", label: "Room 101 · Bed A", conflict: "Current bed" },
  { id: "taken", label: "Room 102 · Bed A", conflict: "Occupied by Alex Test" },
  { id: "free", label: "Room 103 · Bed A", conflict: null },
] };
function mount(extra = {}) {
  const onDone = vi.fn();
  render(<ChangeBedAction residentId="resident" residentName="Ada Test" facilityId="facility" currentBedLabel="101-A" onDone={onDone} {...extra} />);
  return onDone;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "nurse";
  mocks.load.mockResolvedValue(snapshot);
  mocks.rpc.mockResolvedValue({ data: "free", error: null });
});
afterEach(cleanup);

describe("Change bed", () => {
  it.each(["caregiver", "family", "", "billing"])("hides the action from %s", (role) => {
    mocks.role = role;
    mount({ initiallyOpen: true });
    expect(screen.queryByRole("button", { name: "Change bed" })).not.toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("opens from a deep link, displays conflicts and requires an explicit choice", async () => {
    mount({ initiallyOpen: true });
    expect(await screen.findByRole("radio", { name: /Occupied by Alex/ })).toBeDisabled();
    expect(screen.getByText("Facility: Test facility")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Current bed/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm bed change" })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("confirms with the freshly read expected bed and refreshes the caller after success", async () => {
    const user = userEvent.setup();
    const done = mount();
    await user.click(screen.getByRole("button", { name: "Change bed" }));
    await user.click(await screen.findByRole("radio", { name: /Room 103/ }));
    await user.click(screen.getByRole("button", { name: "Confirm bed change" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledWith("change_resident_bed", { p_resident_id: "resident", p_target_bed_id: "free", p_expected_bed_id: "old" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps the dialog open and refreshes conflicts after a concurrent claim", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "bed no longer available" } });
    const user = userEvent.setup();
    const done = mount({ initiallyOpen: true });
    await user.click(await screen.findByRole("radio", { name: /Room 103/ }));
    mocks.load.mockResolvedValue({ ...snapshot, options: snapshot.options.map((bed) => bed.id === "free" ? { ...bed, conflict: "Occupied by another resident" } : bed) });
    await user.click(screen.getByRole("button", { name: "Confirm bed change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("choose another bed");
    await waitFor(() => expect(screen.getByRole("radio", { name: /Room 103/ })).toBeDisabled());
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm bed change" })).toBeDisabled();
  });
  it("fails closed when availability cannot be loaded and supports retry", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Bed availability could not be verified."));
    const user = userEvent.setup();
    mount({ initiallyOpen: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified");
    expect(screen.getByRole("button", { name: "Confirm bed change" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Refresh availability" }));
    expect(await screen.findByRole("radio", { name: /Room 103/ })).toBeEnabled();
  });
  it("does not claim success without a server receipt", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    const done = mount({ initiallyOpen: true });
    await user.click(await screen.findByRole("radio", { name: /Room 103/ }));
    await user.click(screen.getByRole("button", { name: "Confirm bed change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
    expect(done).not.toHaveBeenCalled();
  });
});
