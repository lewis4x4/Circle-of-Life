import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannedScheduleContext } from "./PlannedScheduleContext";
import { fetchScheduleAssignmentIntervals } from "@/lib/schedules/assignment-context";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/schedules/assignment-context", () => ({ fetchScheduleAssignmentIntervals: vi.fn(), formatAssignmentInterval: (row: { label: string }) => row.label }));
const fetch = vi.mocked(fetchScheduleAssignmentIntervals);
const props = { facilityIds: ["facility"], from: "2026-09-24T00:00:00Z", to: "2026-09-25T00:00:00Z" };
afterEach(() => vi.clearAllMocks());
describe("separate planned schedule context", () => {
  it("shows split block hours without gap hours or altering payroll presentation", async () => {
    fetch.mockResolvedValue([0, 1].map((index) => ({ assignment_id: `assignment-${index}`, schedule_id: "schedule", staff_id: "staff", facility_id: "facility", service_date: "2026-09-24", starts_at: index ? "2026-09-24T20:00:00Z" : "2026-09-24T10:00:00Z", ends_at: index ? "2026-09-24T22:00:00Z" : "2026-09-24T17:00:00Z", time_zone: "America/New_York", preset_id: "preset", preset_version: 1, label: "Kitchen split", color: "#338866", staff_role: "cook", group_id: "group", block_index: index, block_count: 2, legacy_shift_type: "custom", status: "assigned", is_legacy: false })));
    render(<PlannedScheduleContext {...props} payroll />);
    expect(await screen.findByText(/9.00 planned hours/)).toBeInTheDocument();
    expect(screen.getByText(/does not change this packet/)).toBeInTheDocument();
    expect(screen.getByText(/short-turnaround exception still requires review/)).toBeInTheDocument();
    expect(screen.getByText(/block 2 of 2/)).toBeInTheDocument();
  });
  it("keeps failed lookup distinct from empty results and staff-scopes all-facility reads", async () => {
    fetch.mockRejectedValue(new Error("Unavailable"));
    render(<PlannedScheduleContext {...props} facilityIds={[]} staffId="staff" />);
    expect(await screen.findByText(/Schedule context could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/No published work blocks/)).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ facilityId: null, staffId: "staff" })));
  });
});
