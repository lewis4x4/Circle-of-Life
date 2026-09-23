import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FacilityGate } from "./FacilityGate";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { readSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import { singleFacilityDefault } from "@/lib/facilities/single-facility-default";

const HOMEWOOD = { id: "11111111-1111-4111-8111-111111111111", name: "Homewood Lodge" };
const OAKRIDGE = { id: "22222222-2222-4222-8222-222222222222", name: "Oakridge ALF" };

const refreshMock = vi.fn();
const fetchOptionsMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null, loading: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => authMock }));
vi.mock("@/lib/admin-facilities", () => ({ fetchAdminFacilityOptions: fetchOptionsMock }));

function seedStore(facilities: { id: string; name: string }[], selectedFacilityId: string | null = null) {
  useFacilityStore.setState({
    selectedFacilityId,
    availableFacilities: facilities,
    facilitiesFetchedAt: Date.now(),
    facilitiesCacheUserId: "user-1",
  });
}

function Page() {
  const facilityId = useFacilityStore((s) => s.selectedFacilityId);
  return <p>Ledger for {facilityId}</p>;
}

beforeEach(() => {
  refreshMock.mockReset();
  fetchOptionsMock.mockReset();
  authMock.user = { id: "user-1" };
  document.cookie = "haven_selected_facility=all; Path=/";
});

afterEach(() => {
  useFacilityStore.setState({ selectedFacilityId: null, availableFacilities: [], facilitiesCacheUserId: null });
});

describe("FacilityGate", () => {
  it("under All facilities shows the page title, the reason and an inline picker — never the page body", () => {
    seedStore([HOMEWOOD, OAKRIDGE]);
    render(
      <FacilityGate title="Cash & resident trust" reason="Ledgers are kept per building.">
        <Page />
      </FacilityGate>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Cash & resident trust" })).toBeInTheDocument();
    expect(screen.getByText("Ledgers are kept per building.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Homewood Lodge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Oakridge ALF" })).toBeInTheDocument();
    expect(screen.queryByText(/Ledger for/)).not.toBeInTheDocument();
  });

  it("choosing a facility sets the header scope (store + cookie + refresh) and opens the page in place", async () => {
    seedStore([HOMEWOOD, OAKRIDGE]);
    const user = userEvent.setup();
    render(
      <FacilityGate title="Cash & resident trust" reason="Ledgers are kept per building.">
        <Page />
      </FacilityGate>,
    );

    await user.click(screen.getByRole("button", { name: "Oakridge ALF" }));

    expect(useFacilityStore.getState().selectedFacilityId).toBe(OAKRIDGE.id);
    expect(readSelectedFacilityCookie()).toBe(OAKRIDGE.id);
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.getByText(`Ledger for ${OAKRIDGE.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId("facility-gate")).not.toBeInTheDocument();
  });

  it("a server page stays gated on its cookie scope until the refresh re-renders it", () => {
    seedStore([HOMEWOOD, OAKRIDGE], OAKRIDGE.id);
    const { rerender } = render(
      <FacilityGate facilityId={null} title="Clinical Desk" reason="Assessments are due per building.">
        <p>Queue</p>
      </FacilityGate>,
    );
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();

    rerender(
      <FacilityGate facilityId={OAKRIDGE.id} title="Clinical Desk" reason="Assessments are due per building.">
        <p>Queue</p>
      </FacilityGate>,
    );
    expect(screen.getByText("Queue")).toBeInTheDocument();
  });

  it("a user with exactly one facility never has to choose it", async () => {
    seedStore([HOMEWOOD]);
    render(
      <FacilityGate title="Front desk" reason="Front desk logs are per building.">
        <Page />
      </FacilityGate>,
    );

    expect(await screen.findByText(`Ledger for ${HOMEWOOD.id}`)).toBeInTheDocument();
    expect(readSelectedFacilityCookie()).toBe(HOMEWOOD.id);
  });

  it("with no header cache (no shell) it loads the user's facilities itself", async () => {
    fetchOptionsMock.mockResolvedValue([HOMEWOOD, OAKRIDGE]);
    render(
      <FacilityGate title="Clinical Desk" reason="Assessments are due per building.">
        <Page />
      </FacilityGate>,
    );

    expect(screen.getByText("Loading your facilities…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Homewood Lodge" })).toBeInTheDocument();
    expect(fetchOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the facility list cannot load, instead of spinning", async () => {
    fetchOptionsMock.mockRejectedValue(new Error("network"));
    render(
      <FacilityGate title="Clinical Desk" reason="Assessments are due per building.">
        <Page />
      </FacilityGate>,
    );

    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
  });

  it("a facility fetch that throws or returns nothing reads as a load failure, not a crash", async () => {
    fetchOptionsMock.mockReturnValue(undefined);
    const { unmount } = render(
      <FacilityGate title="Clinical Desk" reason="Assessments are due per building.">
        <Page />
      </FacilityGate>,
    );
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
    unmount();

    fetchOptionsMock.mockImplementation(() => {
      throw new Error("sync");
    });
    render(
      <FacilityGate title="Clinical Desk" reason="Assessments are due per building.">
        <Page />
      </FacilityGate>,
    );
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
  });

  it("respects a form's facility-change guard", async () => {
    seedStore([HOMEWOOD, OAKRIDGE]);
    const release = useFacilityStore.getState().registerFacilityChangeGuard(() => false);
    const user = userEvent.setup();
    render(
      <FacilityGate title="Letters" reason="Letters print on a building's letterhead.">
        <Page />
      </FacilityGate>,
    );

    await user.click(screen.getByRole("button", { name: "Homewood Lodge" }));

    expect(useFacilityStore.getState().selectedFacilityId).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    act(() => release());
  });
});

describe("singleFacilityDefault", () => {
  it("defaults only a one-facility user who is not already on it", () => {
    expect(singleFacilityDefault([HOMEWOOD], null)).toBe(HOMEWOOD.id);
    expect(singleFacilityDefault([HOMEWOOD], HOMEWOOD.id)).toBeNull();
    expect(singleFacilityDefault([HOMEWOOD, OAKRIDGE], null)).toBeNull();
    expect(singleFacilityDefault([], null)).toBeNull();
  });
});
