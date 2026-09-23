import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  role: "facility_admin",
  schedule: { id: "week-1", facility_id: "facility-1", organization_id: "org-1", week_start_date: "2026-09-28", status: "draft", updated_at: "2026-09-23T12:00:00Z", published_at: null, notes: null },
  assignments: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "week-1" }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: state.role }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: null }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: state.rpc,
  from: (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order"]) query[method] = () => query;
    query.maybeSingle = async () => ({ data: state.schedule, error: null });
    query.single = async () => ({ data: { timezone: "America/New_York" }, error: null });
    query.range = async () => {
      const data = table === "staff" ? [{ id: "staff-1", first_name: "Test", last_name: "Person", employment_status: "active", staff_role: "med_tech" }]
        : table === "facility_shift_definitions" ? [{ id: "definition-1", label: "Day", roster_shift_type: "day", starts_at_local: "06:00:00", ends_at_local: "18:00:00" }]
        : state.assignments;
      return { data, count: data.length, error: null };
    };
    return query;
  },
}) }));

import SchedulePage from "./page";

beforeEach(() => {
  state.role = "facility_admin";
  state.schedule.status = "draft";
  state.assignments = [];
  state.rpc.mockReset().mockResolvedValue({ data: "week-1", error: null });
});

describe("weekly schedule editing", () => {
  it("saves configured grid cells together and shows actual shift hours", async () => {
    render(<SchedulePage />);
    const firstCell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    fireEvent.click(firstCell);
    expect(screen.getByText("12.0 h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish week" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", {
      p_schedule_id: "week-1", p_expected_updated_at: "2026-09-23T12:00:00Z",
      p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: "definition-1" }],
    }));
  });
  it("retains unsaved changes when the database rejects a stale save", async () => {
    state.rpc.mockResolvedValue({ error: { message: "Schedule changed. Reload before saving." } });
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    expect(await screen.findByText("Schedule changed. Reload before saving.")).toBeInTheDocument();
    expect(screen.getByText("1 unsaved cell change.")).toBeInTheDocument();
    expect(screen.getByText("12.0 h")).toBeInTheDocument();
  });
  it("keeps published schedules read only with recorded times", async () => {
    state.schedule.status = "published";
    state.assignments = [{ id: "assignment-1", staff_id: "staff-1", shift_date: "2026-09-28", shift_type: "day", custom_start_time: "06:00:00", custom_end_time: "18:00:00", status: "assigned" }];
    render(<SchedulePage />);
    expect(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Day 6:00a–6:00p/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Publish week" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove shift" })).not.toBeInTheDocument();
  });
  it("does not offer med techs schedule write controls", async () => {
    state.role = "med_tech";
    render(<SchedulePage />);
    expect(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Copy last week" })).not.toBeInTheDocument();
  });
});
