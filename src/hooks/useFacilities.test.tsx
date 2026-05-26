import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFacilities } from "./useFacilities";

const facilityResponse = {
  facilities: [
    {
      id: "facility-1",
      name: "Oakridge ALF",
      occupancy_count: 41,
      total_licensed_beds: 52,
      occupancy_pct: 0.788,
    },
  ],
  total: 1,
  page: 1,
  has_next: false,
};

describe("useFacilities", () => {
  let nowMs = Date.parse("2026-05-26T12:00:00.000Z");

  beforeEach(() => {
    nowMs = Date.parse("2026-05-26T12:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => facilityResponse,
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reuses the cached facility response for the same query within the ttl", async () => {
    const first = renderHook(() => useFacilities({ search: "oakridge-cache-hit" }));

    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.result.current.facilities[0]).toMatchObject({
      id: "facility-1",
      name: "Oakridge ALF",
      current_occupancy: 41,
      licensed_beds: 52,
      occupancy_pct: 0.788,
    });

    first.unmount();

    const second = renderHook(() => useFacilities({ search: "oakridge-cache-hit" }));

    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.result.current.facilities[0]?.name).toBe("Oakridge ALF");
  });

  it("refreshes visible facilities after the ttl expires and the tab becomes visible", async () => {
    renderHook(() => useFacilities({ search: "oakridge-cache-stale" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    nowMs = Date.parse("2026-05-26T12:01:01.000Z");
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
