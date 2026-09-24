import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduleRow } from "@/lib/schedules/load-schedules";

const FACILITY_A = "11111111-1111-4111-8111-111111111111";
const FACILITY_B = "22222222-2222-4222-8222-222222222222";
const FACILITY_C = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({ facilityId: "11111111-1111-4111-8111-111111111111" as string | null, load: vi.fn() }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: state.facilityId }) }));
vi.mock("@/lib/schedules/load-schedules", () => ({ fetchSchedulesFromSupabase: state.load }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { AdminSchedulesPageClient } from "./AdminSchedulesPageClient";

const rows: ScheduleRow[] = [
  { id: "week-a", weekStartDate: "2026-09-28", status: "draft", publishedAt: null, notes: null },
  { id: "week-b", weekStartDate: "2026-10-05", status: "draft", publishedAt: null, notes: null },
  { id: "week-c", weekStartDate: "2026-09-21", status: "published", publishedAt: "2026-09-20T12:00:00Z", notes: null },
];
const props = { initialRows: rows, initialError: null, initialFacilityId: FACILITY_A };

beforeEach(() => {
  state.facilityId = FACILITY_A;
  state.load.mockReset().mockResolvedValue([]);
});

describe("schedule draft metric", () => {
  it("shows the shared tile with the successful server count", () => {
    render(<AdminSchedulesPageClient {...props} />);
    expect(screen.getByRole("article", { name: "Draft weeks: 2" })).toHaveAttribute("data-metric-state", "value");
    expect(screen.getByRole("heading", { name: "Schedule", exact: true })).toBeInTheDocument();
    expect(state.load).not.toHaveBeenCalled();
  });

  it("allows a real zero after a successful empty all-facilities read", () => {
    state.facilityId = null;
    render(<AdminSchedulesPageClient initialRows={[]} initialError={null} initialFacilityId={null} />);
    expect(screen.getByRole("article", { name: "Draft weeks: 0" })).toHaveAttribute("data-metric-state", "value");
    expect(screen.getByText("No schedules in this scope")).toBeInTheDocument();
  });

  it("shows loading instead of the previous scope's count until the new read succeeds", async () => {
    let resolve!: (value: ScheduleRow[]) => void;
    state.load.mockReturnValue(new Promise<ScheduleRow[]>((done) => { resolve = done; }));
    const ui = render(<AdminSchedulesPageClient {...props} />);
    state.facilityId = FACILITY_B;
    ui.rerender(<AdminSchedulesPageClient {...props} />);
    expect(screen.getByRole("article", { name: "Draft weeks: Loading…" })).toHaveAttribute("data-metric-state", "loading");
    expect(screen.queryByRole("article", { name: "Draft weeks: 2" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Draft weeks: 0" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Week of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download schedule weeks CSV" })).toBeNull();
    expect(screen.queryByText("No schedules in this scope")).toBeNull();
    await act(async () => { resolve([]); });
    expect(await screen.findByRole("article", { name: "Draft weeks: 0" })).toHaveAttribute("data-metric-state", "value");
  });

  it("hides previous-scope weeks and CSV when the new facility read fails", async () => {
    state.load.mockRejectedValue(new Error("Schedule read unavailable"));
    const ui = render(<AdminSchedulesPageClient {...props} />);
    expect(screen.getAllByRole("link", { name: /Week of/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Download schedule weeks CSV" })).toBeInTheDocument();
    state.facilityId = FACILITY_B;
    ui.rerender(<AdminSchedulesPageClient {...props} />);
    expect(await screen.findByRole("article", { name: "Draft weeks: Unavailable" })).toHaveAttribute("data-metric-state", "unavailable");
    expect(screen.queryByRole("article", { name: "Draft weeks: 2" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Draft weeks: 0" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Week of/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download schedule weeks CSV" })).toBeNull();
    expect(screen.queryByText("No schedules in this scope")).toBeNull();
    expect(screen.queryByText("No schedules match the current filters")).toBeNull();
    expect(screen.getByText(/Schedule read unavailable/)).toBeInTheDocument();
  });

  it("never converts a failed initial read into a zero count", async () => {
    state.load.mockRejectedValue(new Error("Schedule read unavailable"));
    render(<AdminSchedulesPageClient initialRows={[]} initialError="Schedule read unavailable" initialFacilityId={FACILITY_A} />);
    expect(await screen.findByRole("article", { name: "Draft weeks: Unavailable" })).toHaveAttribute("data-metric-state", "unavailable");
    expect(screen.queryByRole("article", { name: "Draft weeks: 0" })).toBeNull();
    expect(screen.queryByText("No schedules in this scope")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download schedule weeks CSV" })).toBeNull();
    expect(screen.getByText(/Schedule read unavailable/)).toBeInTheDocument();
  });

  it("does not let a late response replace the active scope's metric", async () => {
    let resolveOlder!: (value: ScheduleRow[]) => void;
    state.load.mockImplementation((facilityId: string) => facilityId === FACILITY_B
      ? new Promise<ScheduleRow[]>((resolve) => { resolveOlder = resolve; })
      : Promise.resolve([]));
    const ui = render(<AdminSchedulesPageClient {...props} />);
    state.facilityId = FACILITY_B;
    ui.rerender(<AdminSchedulesPageClient {...props} />);
    state.facilityId = FACILITY_C;
    ui.rerender(<AdminSchedulesPageClient {...props} />);
    await screen.findByRole("article", { name: "Draft weeks: 0" });
    await act(async () => { resolveOlder(rows); });
    expect(screen.getByRole("article", { name: "Draft weeks: 0" })).toHaveAttribute("data-metric-state", "value");
  });
});
