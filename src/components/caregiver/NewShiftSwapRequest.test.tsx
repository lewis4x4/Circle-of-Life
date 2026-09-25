import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ intervals: vi.fn(), insert: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/schedules/assignment-context", async (original) => ({ ...(await original<typeof import("@/lib/schedules/assignment-context")>()), fetchScheduleAssignmentIntervals: mocks.intervals }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: mocks.rpc,
  from: () => ({ insert: (payload: unknown) => { mocks.insert(payload); return { select: () => ({ single: async () => ({ data: { id: "new-request" }, error: null }) }) }; } }),
}) }));
import { NewShiftSwapRequest } from "./NewShiftSwapRequest";

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const base = { schedule_id: "week", staff_id: "me", facility_id: "facility", group_id: "group", block_count: 2, service_date: "2026-09-28", label: "Cook", time_zone: "America/New_York", color: "#008000", staff_role: "dietary_staff" };
  mocks.intervals.mockResolvedValue([
    { ...base, assignment_id: "am", block_index: 0, starts_at: "2026-09-28T10:00:00Z", ends_at: "2026-09-28T17:00:00Z" },
    { ...base, assignment_id: "pm", block_index: 1, starts_at: "2026-09-28T20:00:00Z", ends_at: "2026-09-28T22:00:00Z" },
  ]);
  mocks.rpc.mockImplementation(() => { const q = { order: () => q, range: async () => ({ data: [{ staff_id: "coworker", staff_name: "Other Cook", staff_role: "dietary_staff", blocks: [] }], count: 1, error: null }) }; return q; });
});
afterEach(() => vi.useRealTimers());

describe("creating a whole shift-group request", () => {
  it("uses one complete option, shows both blocks, and leaves consent snapshots to the server", async () => {
    const onCreated = vi.fn(async () => {});
    render(<NewShiftSwapRequest ownStaffIds={["me"]} organizationId="org" onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "Request coverage or exchange" }));
    await screen.findByRole("option", { name: /Cook.*2 blocks.*9.0 hours/ });
    fireEvent.change(screen.getByLabelText("Your work"), { target: { value: "am" } });
    await screen.findByRole("option", { name: "Other Cook" });
    fireEvent.change(screen.getByLabelText("Coworker"), { target: { value: "coworker" } });
    expect(screen.getByText(/6:00 AM–1:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/4:00 PM–6:00 PM/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mocks.insert).toHaveBeenCalledWith({ organization_id: "org", facility_id: "facility", requesting_staff_id: "me", requesting_assignment_id: "am", covering_staff_id: "coworker", covering_assignment_id: null, swap_scope: "group", swap_type: "cover", reason: null, status: "pending" });
    expect(mocks.rpc).toHaveBeenCalledWith("schedule_swap_candidates", { p_assignment_id: "am" }, { count: "exact" });
  });
  it("does not offer a truncated split group", async () => {
    mocks.intervals.mockResolvedValue([{ assignment_id: "pm", staff_id: "me", group_id: "group", block_index: 1, block_count: 2, starts_at: "2026-09-28T20:00:00Z", ends_at: "2026-09-28T22:00:00Z" }]);
    render(<NewShiftSwapRequest ownStaffIds={["me"]} organizationId="org" onCreated={async () => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Request coverage or exchange" }));
    expect(await screen.findByText(/No complete future published work/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create request" })).toBeDisabled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
