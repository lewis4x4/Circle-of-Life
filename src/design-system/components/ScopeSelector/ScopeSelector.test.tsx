import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScopeSelector } from "./ScopeSelector";

const mockReplace = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const owners = [
  { id: "o1", label: "Oakridge Owner" },
  { id: "o2", label: "Rising Oaks Owner" },
];
const groups = [
  { id: "g1", label: "Florida South", ownerId: "o1" },
  { id: "g2", label: "Florida North", ownerId: "o2" },
];
const facilities = [
  { id: "f1", label: "Oakridge ALF", ownerId: "o1", groupId: "g1" },
  { id: "f2", label: "Homewood Lodge", ownerId: "o1", groupId: "g1" },
  { id: "f3", label: "Rising Oaks", ownerId: "o2", groupId: "g2" },
];

describe("<ScopeSelector />", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockSearch = "";
  });

  it("renders empty state with all owners and facilities by default", () => {
    render(<ScopeSelector owners={owners} groups={groups} facilities={facilities} />);
    expect(screen.getByRole("group", { name: /scope selector/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /owner/i })).toHaveValue("");
    expect(screen.getByText(/all facilities in scope/i)).toBeInTheDocument();
    for (const facility of facilities) {
      expect(screen.getByLabelText(new RegExp(`^${facility.label}$`, "i"))).toBeInTheDocument();
    }
  });

  it("filters groups when an owner is selected", async () => {
    const user = userEvent.setup();
    render(<ScopeSelector owners={owners} groups={groups} facilities={facilities} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /owner/i }), "o1");

    expect(mockReplace).toHaveBeenCalled();
    const firstCall = mockReplace.mock.calls[0]![0] as string;
    expect(firstCall).toContain("owner=o1");
  });

  it("renders ownerOnly state when only ownerId is set via override", () => {
    render(
      <ScopeSelector
        owners={owners}
        groups={groups}
        facilities={facilities}
        scopeOverride={{ ownerId: "o1" }}
      />,
    );
    expect(screen.getByRole("combobox", { name: /owner/i })).toHaveValue("o1");
    expect(screen.getByLabelText(/^oakridge alf$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^rising oaks$/i)).toBeNull();
  });

  it("renders ownerGroupFacility state with single facility selection", () => {
    const onChange = vi.fn();
    render(
      <ScopeSelector
        owners={owners}
        groups={groups}
        facilities={facilities}
        scopeOverride={{ ownerId: "o1", groupId: "g1", facilityIds: ["f1"] }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/1 facility selected/i)).toBeInTheDocument();
  });

  it("renders multiFacility state with count", () => {
    render(
      <ScopeSelector
        owners={owners}
        groups={groups}
        facilities={facilities}
        scopeOverride={{ ownerId: "o1", groupId: "g1", facilityIds: ["f1", "f2"] }}
      />,
    );
    expect(screen.getByText(/2 facilities selected/i)).toBeInTheDocument();
  });

  it("calls onChange override instead of URL update when provided", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ScopeSelector
        owners={owners}
        groups={groups}
        facilities={facilities}
        scopeOverride={{}}
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: /owner/i }), "o2");
    expect(onChange).toHaveBeenCalledWith({ ownerId: "o2" });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
