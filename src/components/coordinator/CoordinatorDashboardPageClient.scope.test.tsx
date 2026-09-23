import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";

const store = vi.hoisted(() => ({ selectedFacilityId: null as string | null }));
const fetchCoordinatorDashboardBrief = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: store.selectedFacilityId }),
}));
vi.mock("@/lib/coordinator/dashboard-brief", () => ({ fetchCoordinatorDashboardBrief }));

import { CoordinatorDashboardPageClient } from "./CoordinatorDashboardPageClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("coordinator dashboard keeps the latest read (COL-682)", () => {
  beforeEach(() => {
    fetchCoordinatorDashboardBrief.mockReset();
    store.selectedFacilityId = null;
  });

  it("does not let the pre-hydration unscoped read's failure replace the facility's dashboard", async () => {
    const unscoped = deferred<never>();
    const scoped = deferred<unknown>();
    fetchCoordinatorDashboardBrief.mockImplementation((facilityId: string | null) =>
      facilityId == null ? unscoped.promise : scoped.promise,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const view = render(<CoordinatorDashboardPageClient initialBrief={null} initialError={null} initialFacilityId={HOMEWOOD} />);
    store.selectedFacilityId = HOMEWOOD;
    view.rerender(<CoordinatorDashboardPageClient initialBrief={null} initialError={null} initialFacilityId={HOMEWOOD} />);
    expect(fetchCoordinatorDashboardBrief).toHaveBeenCalledWith(null);
    expect(fetchCoordinatorDashboardBrief).toHaveBeenCalledWith(HOMEWOOD);

    await act(async () => {
      unscoped.reject(new Error("Select a facility."));
      await Promise.resolve();
    });

    expect(screen.queryByText("Unable to load coordinator dashboard.")).toBeNull();
  });
});
