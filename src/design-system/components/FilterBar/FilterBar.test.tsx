import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "./FilterBar";

const mockReplace = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const facilities = [
  { id: "f1", label: "Oakridge ALF" },
  { id: "f2", label: "Homewood Lodge" },
];
const regions = [
  { id: "r1", label: "FL Central" },
  { id: "r2", label: "FL North" },
];
const statuses = [
  { id: "open", label: "Open" },
  { id: "ack", label: "Acknowledged" },
];

describe("<FilterBar />", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockSearch = "";
  });

  it("renders default state with Reset and Save view buttons", () => {
    render(
      <FilterBar
        dashboardId="/admin"
        facilities={facilities}
        regions={regions}
        statuses={statuses}
      />,
    );

    expect(screen.getByRole("toolbar", { name: /filter bar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save view/i })).toBeInTheDocument();
    expect(screen.getByText(/no filters active/i)).toBeInTheDocument();
  });

  it("renders withSavedView state showing saved count", () => {
    render(
      <FilterBar
        dashboardId="/admin"
        facilities={facilities}
        savedViews={[
          { id: "v1", name: "Morning triage" },
          { id: "v2", name: "Regulatory watch" },
        ]}
      />,
    );
    expect(screen.getByLabelText(/2 saved views/i)).toBeInTheDocument();
  });

  it("renders filtersActive state with warning copy when facilities selected", async () => {
    const user = userEvent.setup();
    render(
      <FilterBar
        dashboardId="/admin"
        facilities={facilities}
        scopeOverride={{ facilityIds: ["f1"] }}
        onScopeChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/filters active/i)).toBeInTheDocument();
    // Status chip toggle exercises keyboard target
    const statusChip = screen.queryByRole("button", { name: /acknowledged/i });
    if (statusChip) {
      await user.click(statusChip);
    }
  });

  it("stubbed save-view logs and transitions to Saved label", async () => {
    const user = userEvent.setup();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    render(
      <FilterBar
        dashboardId="/admin"
        facilities={facilities}
        scopeOverride={{ facilityIds: ["f1"] }}
        onScopeChange={vi.fn()}
      />,
    );

    const saveBtn = screen.getByRole("button", { name: /save view/i });
    await user.click(saveBtn);
    await screen.findByRole("button", { name: /^saved$/i });
    expect(infoSpy).toHaveBeenCalledWith(
      "[ui-v2-s3] stubbed save-view",
      expect.objectContaining({ success: true }),
    );

    infoSpy.mockRestore();
  });

  it("Reset clears facility scope and status selections via callbacks", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    const onStatusChange = vi.fn();
    const onRegionChange = vi.fn();
    render(
      <FilterBar
        dashboardId="/admin"
        facilities={facilities}
        regions={regions}
        statuses={statuses}
        scopeOverride={{ facilityIds: ["f1"], dateRange: { start: "2026-04-01", end: "2026-04-30" } }}
        onScopeChange={onScopeChange}
        selectedStatusIds={["open"]}
        onStatusChange={onStatusChange}
        selectedRegionId="r1"
        onRegionChange={onRegionChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /reset/i }));
    expect(onScopeChange).toHaveBeenCalledWith({ dateRange: undefined, facilityIds: undefined });
    expect(onStatusChange).toHaveBeenCalledWith([]);
    expect(onRegionChange).toHaveBeenCalledWith(undefined);
  });
});
