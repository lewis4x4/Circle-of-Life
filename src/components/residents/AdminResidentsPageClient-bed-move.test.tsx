import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminResidentsPageClient } from "./AdminResidentsPageClient";
import type { ResidentRow } from "@/lib/residents/load-residents";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/residents",
}));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: null }) }));
vi.mock("@/components/residents/ChangeBedAction", () => ({
  ChangeBedAction: ({ residentName, facilityId }: { residentName: string; facilityId: string }) => <button>Change bed for {residentName} at {facilityId}</button>,
}));
const rows: ResidentRow[] = ["Ada", "Alex"].map((name, index) => ({
  id: `resident-${index}`, facilityId: `facility-${index}`, name, initials: name.slice(0, 2), room: `${101 + index}-A`, unit: "East", acuity: 1, acuityLevel: "level_1", adlStatus: "independent", status: "active", careSummary: "", updatedAtIso: null,
}));
afterEach(cleanup);
describe("roster bed changes", () => {
  it("uses the selected resident's facility even in the all-facility roster and requires exactly one selection", async () => {
    const user = userEvent.setup();
    render(<AdminResidentsPageClient initialRows={rows} initialError={null} initialFacilityId={null} initialMetrics={null} detailBaseHref="/admin/residents" />);
    expect(screen.queryByRole("button", { name: /Change bed for/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    expect(screen.getByRole("button", { name: "Change bed for Ada at facility-0" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Alex" }));
    expect(screen.queryByRole("button", { name: /Change bed for/ })).not.toBeInTheDocument();
    expect(screen.getByText("Select one resident to change beds")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    expect(screen.getByRole("button", { name: "Change bed for Alex at facility-1" })).toBeInTheDocument();
  });
});
