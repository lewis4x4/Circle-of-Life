import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShiftStart } from "./ShiftStart";

const mocks = vi.hoisted(() => ({
  user: { id: "operator" },
  start: vi.fn(),
  result: { data: [] as Array<{ id: string; shift_start: string; shift_end: string; status: string }>, error: null as { message: string } | null },
  eq: vi.fn(),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/med-tech/shift-commands", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/med-tech/shift-commands")>()), startMedicationShift: mocks.start }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => {
  const chain = { select: () => chain, eq: (key: string, value: string) => { mocks.eq(key, value); return chain; }, in: () => chain, is: () => chain, gt: () => chain, order: () => chain, limit: async () => mocks.result };
  return chain;
} }) }));

describe("Medication assignment start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockReset().mockResolvedValue("shift");
    mocks.result = { data: [{ id: "shift", shift_start: new Date(Date.now() - 3600000).toISOString(), shift_end: new Date(Date.now() + 3600000).toISOString(), status: "scheduled" }], error: null };
  });
  it("starts the assigned row and refreshes the cockpit only after confirmation", async () => {
    const refresh = vi.fn();
    render(<ShiftStart onStarted={refresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start medication assignment" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.start).toHaveBeenCalledWith("shift");
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "operator");
  });
  it("retains the same assignment after an ambiguous result and allows exact retry", async () => {
    mocks.start.mockRejectedValueOnce(new Error("Response lost"));
    const refresh = vi.fn();
    render(<ShiftStart onStarted={refresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start medication assignment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Response lost");
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start medication assignment" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.start.mock.calls).toEqual([["shift"], ["shift"]]);
  });
  it("distinguishes a read failure from no assignment", async () => {
    mocks.result = { data: [], error: { message: "Assignment service unavailable" } };
    render(<ShiftStart onStarted={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Assignment service unavailable");
    expect(screen.queryByText(/No current or upcoming medication assignment/)).not.toBeInTheDocument();
  });
});
