import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const state = vi.hoisted(() => ({
  role: "facility_admin",
  schedule: { id: "week-1", facility_id: "11111111-1111-4111-8111-111111111111", organization_id: "org-1", week_start_date: "2026-09-28", status: "draft", updated_at: "2026-09-23T12:00:00Z", published_at: null, notes: null },
  assignments: [] as Record<string, unknown>[],
  people: [] as Record<string, unknown>[],
  presets: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/components/workforce/WorkforceContext", () => ({ useWorkforce: () => ({ refresh: state.refresh }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "week-1" }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: state.role }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: (name: string, args: unknown) => {
    if (name !== "schedule_people_for_week") return state.rpc(name, args);
    const query = { order: () => query, range: async () => ({ data: state.people, count: state.people.length, error: null }) };
    return query;
  },
  from: (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order"]) query[method] = () => query;
    query.maybeSingle = async () => ({ data: state.schedule, error: null });
    query.single = async () => ({ data: { name: "Test facility", timezone: "America/New_York" }, error: null });
    query.range = async () => {
      const data = table === "staff" ? state.people : table === "facility_schedule_presets" ? state.presets : state.assignments;
      return { data, count: data.length, error: null };
    };
    return query;
  },
}) }));

import SchedulePage from "./page";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { allowRouteLeave } from "@/components/layout/navigation-pending";

beforeEach(() => {
  useFacilityStore.setState({ selectedFacilityId: null });
  state.refresh.mockClear();
  state.role = "facility_admin";
  state.schedule.status = "draft";
  state.assignments = [];
  state.people = [{ id: "staff-1", facility_id: state.schedule.facility_id, first_name: "Test", last_name: "Person", employment_status: "active", staff_role: "medication_tech", role_assignments: [] }];
  state.presets = [
    { id: "definition-1", label: "Day", roster_shift_type: "day", blocks: [{ start: "06:00", end: "18:00" }], color: "#F9A8D4", allowed_staff_roles: ["medication_tech"], rounding_coverage: true, version: 1, active: true, sort_order: 0 },
    { id: "definition-2", label: "Night", roster_shift_type: "night", blocks: [{ start: "18:00", end: "06:00" }], color: "#93C5FD", allowed_staff_roles: ["medication_tech"], rounding_coverage: true, version: 1, active: true, sort_order: 1 },
  ];
  state.rpc.mockReset().mockResolvedValue({ data: "week-1", error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("weekly schedule editing", () => {
  it("reaches Off through four ordinary cell clicks without opening a dialog", async () => {
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    cell.focus();
    for (const label of ["Day", "Night", "Custom", "Off"]) {
      fireEvent.click(cell);
      expect(cell).toHaveAccessibleName(new RegExp(label));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(cell).toHaveFocus();
      if (label === "Custom") expect(screen.getByRole("button", { name: "Save 1 changes" })).toBeDisabled();
    }
    expect(screen.queryByText(/unsaved cell change/)).not.toBeInTheDocument();
    expect(allowRouteLeave("/admin/staff", true)).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("exposes the wide grid as a named keyboard-scrollable region on narrow screens", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1040);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
    const ui = render(<SchedulePage />);
    const region = await screen.findByRole("region", { name: "Seven-day employee schedule" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(screen.getByRole("table"));
    expect(ui.container.querySelector('[data-slot="horizontal-scroll-shade-end"]')).toHaveClass("opacity-100");
    fireEvent.click(screen.getByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    expect(screen.getByText("12.0 h")).toBeInTheDocument();
  });

  it("keeps unsaved cells when an operator cancels in-app navigation", async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    const ui = render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    expect(allowRouteLeave("/admin/staff")).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText("1 unsaved cell change.")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    expect(allowRouteLeave("/admin/staff")).toBe(true);
    ui.unmount();
    expect(allowRouteLeave("/admin/staff")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("removes the route guard after saving the changes", async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    expect(allowRouteLeave("/admin/staff", true)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await screen.findByText("Draft saved.");
    expect(allowRouteLeave("/admin/staff")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("cancels a facility switch without losing cells, then discards only after the switch succeeds", async () => {
    const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal("confirm", confirm);
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    const other = "22222222-2222-4222-8222-222222222222";
    let changed = false;
    act(() => { changed = useFacilityStore.getState().setSelectedFacility(other); });
    expect(changed).toBe(false);
    expect(useFacilityStore.getState().selectedFacilityId).toBeNull();
    expect(screen.getByText("1 unsaved cell change.")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    act(() => { changed = useFacilityStore.getState().setSelectedFacility(other); });
    expect(changed).toBe(true);
    expect(screen.queryByText("1 unsaved cell change.")).not.toBeInTheDocument();
    act(() => { useFacilityStore.getState().setSelectedFacility(state.schedule.facility_id); });
    expect(screen.getByRole("button", { name: /Test Person, Mon, Sep 28: Off/ })).toBeEnabled();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("protects a Custom choice and its unapplied edit until the cell is discarded", async () => {
    state.presets = [];
    const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal("confirm", confirm);
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    fireEvent.change(await screen.findByLabelText("Start time"), { target: { value: "09:00" } });
    expect(screen.getByText("1 unsaved cell change.")).toBeInTheDocument();
    expect(allowRouteLeave("/admin/staff", true)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(allowRouteLeave("/admin/staff")).toBe(false);
    act(() => { expect(useFacilityStore.getState().setSelectedFacility("22222222-2222-4222-8222-222222222222")).toBe(false); });
    expect(screen.getByLabelText("Start time")).toHaveValue("09:00");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(allowRouteLeave("/admin/staff", true)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(allowRouteLeave("/admin/staff")).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a discarded Custom editor after switching back to the schedule facility", async () => {
    state.presets = [];
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ }));
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    fireEvent.change(await screen.findByLabelText("Start time"), { target: { value: "09:00" } });
    act(() => { useFacilityStore.getState().setSelectedFacility("22222222-2222-4222-8222-222222222222"); });
    act(() => { useFacilityStore.getState().setSelectedFacility(state.schedule.facility_id); });
    expect(screen.queryByRole("dialog", { name: "Custom shift" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Test Person, Mon, Sep 28: Off/ })).toBeEnabled();
  });

  it("blocks route and facility departure while copying even with no unsaved cells", async () => {
    const confirm = vi.fn().mockReturnValue(true); vi.stubGlobal("confirm", confirm);
    let finish!: (value: unknown) => void;
    state.rpc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy last week" }));
    expect(allowRouteLeave("/admin/staff")).toBe(false);
    act(() => { expect(useFacilityStore.getState().setSelectedFacility("22222222-2222-4222-8222-222222222222")).toBe(false); });
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => { finish({ data: "week-1", error: null }); });
    await screen.findByText(/Last week's assignments copied/);
    expect(allowRouteLeave("/admin/staff")).toBe(true);
    act(() => { expect(useFacilityStore.getState().setSelectedFacility("22222222-2222-4222-8222-222222222222")).toBe(true); });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("saves configured grid cells together and shows actual shift hours", async () => {
    render(<SchedulePage />);
    const firstCell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    fireEvent.click(firstCell);
    expect(screen.getByText("12.0 h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish week" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", {
      p_schedule_id: "week-1", p_expected_updated_at: "2026-09-23T12:00:00Z",
      p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: null, preset_id: "definition-1", expected_preset_version: 1 }],
    }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
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
  it("selects Custom on the third click, cancels explicit editing, and saves overnight times", async () => {
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    fireEvent.click(cell);
    fireEvent.click(cell);
    expect(cell).toHaveAccessibleName(/Night 6:00p–6:00a/);
    fireEvent.click(cell);
    expect(cell).toHaveAccessibleName(/Custom Choose times/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    expect(await screen.findByRole("dialog", { name: "Custom shift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply times" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cell).toHaveAccessibleName(/Custom Choose times/);
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    fireEvent.change(await screen.findByLabelText("Start time"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("Finish time"), { target: { value: "22:00" } });
    expect(screen.getByRole("button", { name: "Apply times" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Finish time"), { target: { value: "04:30" } });
    expect(screen.getByText(/6.5 scheduled hours. Finishes the next day/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply times" }));
    expect(cell).toHaveAccessibleName(/Custom 10:00p–4:30a/);
    expect(screen.getByText("6.5 h")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", {
      p_schedule_id: "week-1", p_expected_updated_at: "2026-09-23T12:00:00Z",
      p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: null, custom_start_time: "22:00", custom_end_time: "04:30", custom_rounding_coverage: false }],
    }));
  });

  it("returns from the empty Custom editor to Off without entering times or leaving a no-op change", async () => {
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    fireEvent.click(cell);
    fireEvent.click(cell);
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    expect(await screen.findByLabelText("Start time")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Apply times" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set off" }));
    expect(cell).toHaveAccessibleName(/Off/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(cell).toHaveFocus());
    expect(screen.queryByText(/unsaved cell change/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(allowRouteLeave("/admin/staff", true)).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("sets a saved custom shift Off despite invalid times, restores cell focus, and saves only on request", async () => {
    state.assignments = [{ id: "assignment-1", staff_id: "staff-1", shift_date: "2026-09-28", shift_type: "custom", shift_definition_id: null, custom_start_time: "09:00:00", custom_end_time: "17:00:00", status: "assigned" }];
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Custom/ });
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    fireEvent.change(await screen.findByLabelText("Finish time"), { target: { value: "09:00" } });
    expect(screen.getByRole("button", { name: "Apply times" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set off" }));
    expect(cell).toHaveAccessibleName(/Off/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit custom times for/ })).not.toBeInTheDocument();
    await waitFor(() => expect(cell).toHaveFocus());
    expect(screen.getByText("1 unsaved cell change.")).toBeInTheDocument();
    expect(allowRouteLeave("/admin/staff", true)).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", {
      p_schedule_id: "week-1", p_expected_updated_at: "2026-09-23T12:00:00Z",
      p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: null }],
    }));
  });

  it("cycles a custom draft cell to Off without leaving a no-op change", async () => {
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    fireEvent.click(cell);
    fireEvent.click(cell);
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    fireEvent.change(await screen.findByLabelText("Start time"), { target: { value: "09:15" } });
    fireEvent.change(screen.getByLabelText("Finish time"), { target: { value: "16:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply times" }));
    fireEvent.click(cell);
    expect(cell).toHaveAccessibleName(/Off/);
    expect(screen.queryByText(/unsaved cell change/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("edits saved custom times and preserves them when cancelled", async () => {
    state.assignments = [{ id: "assignment-1", staff_id: "staff-1", shift_date: "2026-09-28", shift_type: "custom", shift_definition_id: null, custom_start_time: "09:00:00", custom_end_time: "17:00:00", status: "assigned" }];
    render(<SchedulePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    expect(await screen.findByLabelText("Start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("Finish time")).toHaveValue("17:00");
    fireEvent.change(screen.getByLabelText("Finish time"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("8.0 h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply times" }));
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Test Person, Mon, Sep 28: Custom/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", {
      p_schedule_id: "week-1", p_expected_updated_at: "2026-09-23T12:00:00Z",
      p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: null }],
    }));
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
  it.each(["owner", "org_admin", "facility_admin", "manager"])("allows the scheduling leadership permission role %s", async (role) => {
    state.role = role;
    render(<SchedulePage />);
    expect(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy last week" })).toBeEnabled();
  });
  it("does not confuse the administrative-assistant permission role with assistant-administrator leadership", async () => {
    state.role = "admin_assistant";
    render(<SchedulePage />);
    expect(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Manage shift options" })).not.toBeInTheDocument();
  });
  it("uses the dated facility role to offer a split preset and counts one person", async () => {
    state.people[0].role_assignments = [{ role_at_facility: "cook", start_date: "2026-09-28", end_date: "2026-09-30" }];
    state.presets.push({ id: "cook", label: "Cook split", roster_shift_type: "custom", blocks: [{ start: "06:00", end: "13:00" }, { start: "16:00", end: "18:00" }], color: "#16A34A", allowed_staff_roles: ["cook"], rounding_coverage: false, version: 3, active: true, sort_order: 2 });
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    fireEvent.click(cell);
    expect(cell).toHaveAccessibleName(/Cook split 6:00a–1:00p, Cook split 4:00p–6:00p/);
    expect(screen.getByText("9.0 h")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /People scheduled/ })).getAllByRole("cell")[0]).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", expect.objectContaining({ p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: null, preset_id: "cook", expected_preset_version: 3 }] })));
  });

  it("supports three configured choices before Custom and allows one-off split blocks", async () => {
    state.presets = [0, 1, 2].map((index) => ({ ...state.presets[0], id: `choice-${index}`, label: `Choice ${index + 1}`, blocks: [{ start: `${String(index * 8).padStart(2, "0")}:00`, end: `${String((index * 8 + 8) % 24).padStart(2, "0")}:00` }], sort_order: index }));
    render(<SchedulePage />);
    const cell = await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Off/ });
    for (let index = 1; index <= 3; index++) { fireEvent.click(cell); expect(cell).toHaveAccessibleName(new RegExp(`Choice ${index}`)); }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: /Edit custom times for Test Person, Mon, Sep 28/ }));
    fireEvent.change(await screen.findByLabelText("Start time"), { target: { value: "06:00" } });
    fireEvent.change(screen.getByLabelText("Finish time"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add another block" }));
    fireEvent.change(screen.getByLabelText("Block 2 start"), { target: { value: "16:00" } });
    fireEvent.change(screen.getByLabelText("Block 2 finish"), { target: { value: "18:00" } });
    expect(screen.getByText(/9.0 scheduled hours.*Gaps between blocks are excluded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply times" }));
    fireEvent.click(screen.getByRole("button", { name: "Save 1 changes" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("schedule_bulk_upsert", expect.objectContaining({ p_cells: [{ staff_id: "staff-1", shift_date: "2026-09-28", shift_definition_id: null, custom_blocks: [{ start: "06:00", end: "13:00" }, { start: "16:00", end: "18:00" }], custom_rounding_coverage: false }] })));
  });

  it("renders published split snapshots after the preset is renamed or deactivated", async () => {
    state.schedule.status = "published";
    state.presets[0].label = "Changed today"; state.presets[0].active = false;
    state.assignments = [
      { id: "block-1", staff_id: "staff-1", shift_date: "2026-09-28", shift_type: "custom", status: "assigned", custom_start_time: "06:00:00", custom_end_time: "13:00:00", schedule_starts_at: "2026-09-28T10:00:00Z", schedule_ends_at: "2026-09-28T17:00:00Z", schedule_block_index: 0 },
      { id: "block-2", staff_id: "staff-1", shift_date: "2026-09-28", shift_type: "custom", status: "assigned", custom_start_time: "16:00:00", custom_end_time: "18:00:00", schedule_starts_at: "2026-09-28T20:00:00Z", schedule_ends_at: "2026-09-28T22:00:00Z", schedule_block_index: 1 },
    ].map((row) => ({ ...row, schedule_preset_name: "Saved cook shift", schedule_preset_id: "definition-1", schedule_preset_version: 1, schedule_preset_color: "#16A34A", schedule_time_zone: "America/New_York", schedule_group_id: "group-1", schedule_block_count: 2 }));
    render(<SchedulePage />);
    expect(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Saved cook shift/ })).toBeDisabled();
    expect(screen.getByText("9.0 h")).toBeInTheDocument();
    expect(screen.queryByText("Changed today")).not.toBeInTheDocument();
  });

  it("does not treat a missing managed block as an editable complete cell", async () => {
    state.assignments = [{ id: "block-1", staff_id: "staff-1", shift_date: "2026-09-28", shift_type: "custom", status: "assigned", custom_start_time: "06:00:00", custom_end_time: "13:00:00", schedule_group_id: "group-1", schedule_block_index: 0, schedule_block_count: 2 }];
    render(<SchedulePage />);
    expect(await screen.findByRole("button", { name: /Test Person, Mon, Sep 28: Custom/ })).toBeDisabled();
  });

});
