import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";

const store = vi.hoisted(() => ({ selectedFacilityId: null as string | null }));
const fetchMedicationErrors = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: store.selectedFacilityId }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/medications/load-medication-errors", () => ({
  fetchMedicationErrors,
}));
vi.mock("@/components/medications/MedicationErrorReview", () => ({
  MedicationErrorReview: () => null,
}));

import { AdminMedicationErrorsPageClient } from "./AdminMedicationErrorsPageClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("medication errors follow the selected facility when the cookie and store disagree (COL-673)", () => {
  beforeEach(() => {
    fetchMedicationErrors.mockReset();
    store.selectedFacilityId = null;
  });

  it("does not leave the unscoped read's 'Select a facility.' on screen once the facility's read has started", async () => {
    const unscoped = deferred<never>();
    const scoped = deferred<unknown[]>();
    fetchMedicationErrors.mockImplementation((facilityId: string | null) =>
      facilityId == null ? unscoped.promise : scoped.promise,
    );

    // The server rendered Homewood from the scope cookie; the store's first
    // (pre-hydration) read is null, then it hydrates to Homewood.
    const view = render(
      <AdminMedicationErrorsPageClient initialRows={[]} initialError={null} initialFacilityId={HOMEWOOD} />,
    );
    store.selectedFacilityId = HOMEWOOD;
    view.rerender(
      <AdminMedicationErrorsPageClient initialRows={[]} initialError={null} initialFacilityId={HOMEWOOD} />,
    );
    expect(fetchMedicationErrors).toHaveBeenCalledWith(null);
    expect(fetchMedicationErrors).toHaveBeenCalledWith(HOMEWOOD);

    // The unscoped read fails after the facility's read began, then the facility's read lands.
    await act(async () => {
      unscoped.reject(new Error("Select a facility."));
      await Promise.resolve();
    });
    await act(async () => {
      scoped.resolve([{ id: "e1", error_type: "wrong_time", severity: "low", occurred_at: "2026-09-22T12:00:00Z", reviewed_at: null }]);
      await Promise.resolve();
    });

    expect(screen.queryByText("Select a facility.")).toBeNull();
    expect(screen.getByText("wrong time")).toBeInTheDocument();
  });
});
