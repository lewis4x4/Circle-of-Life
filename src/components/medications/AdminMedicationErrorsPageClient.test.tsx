import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminMedicationErrorsPageClient } from "./AdminMedicationErrorsPageClient";
import { useFacilityStore } from "@/hooks/useFacilityStore";

const HOMEWOOD = { id: "11111111-1111-4111-8111-111111111111", name: "Homewood Lodge" };
const OAKRIDGE = { id: "22222222-2222-4222-8222-222222222222", name: "Oakridge ALF" };

const fetchMedicationErrorsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));
vi.mock("@/lib/medications/load-medication-errors", () => ({
  fetchMedicationErrors: fetchMedicationErrorsMock,
}));
vi.mock("@/components/medications/MedicationErrorReview", () => ({
  MedicationErrorReview: () => null,
}));

afterEach(() => {
  fetchMedicationErrorsMock.mockReset();
  useFacilityStore.setState({ selectedFacilityId: null, availableFacilities: [], facilitiesCacheUserId: null });
});

describe("AdminMedicationErrorsPageClient under All facilities (COL-651)", () => {
  it("shows the facility gate instead of a red error and zero KPIs, and never queries", async () => {
    useFacilityStore.setState({
      selectedFacilityId: null,
      availableFacilities: [HOMEWOOD, OAKRIDGE],
      facilitiesFetchedAt: Date.now(),
      facilitiesCacheUserId: "user-1",
    });

    render(<AdminMedicationErrorsPageClient initialRows={[]} initialError={null} initialFacilityId={null} />);

    expect(await screen.findByTestId("facility-gate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Homewood Lodge" })).toBeInTheDocument();
    expect(screen.queryByText("In view")).not.toBeInTheDocument();
    expect(screen.queryByText(/select a facility/i)).not.toBeInTheDocument();
    expect(fetchMedicationErrorsMock).not.toHaveBeenCalled();
  });

  it("loads the list once a facility is in scope", async () => {
    fetchMedicationErrorsMock.mockResolvedValue([]);
    useFacilityStore.setState({
      selectedFacilityId: HOMEWOOD.id,
      availableFacilities: [HOMEWOOD, OAKRIDGE],
      facilitiesFetchedAt: Date.now(),
      facilitiesCacheUserId: "user-1",
    });

    render(<AdminMedicationErrorsPageClient initialRows={[]} initialError={null} initialFacilityId={null} />);

    await waitFor(() => expect(fetchMedicationErrorsMock).toHaveBeenCalledWith(HOMEWOOD.id));
    expect(screen.queryByTestId("facility-gate")).not.toBeInTheDocument();
    expect(await screen.findByText("In view")).toBeInTheDocument();
  });
});
