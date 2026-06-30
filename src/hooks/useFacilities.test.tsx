import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFacilities, invalidateFacilitiesCache } from "./useFacilities";

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

function createTestQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

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
    const { wrapper } = createTestQueryWrapper();
    const first = renderHook(() => useFacilities({ search: "oakridge-cache-hit" }), { wrapper });

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

    const second = renderHook(() => useFacilities({ search: "oakridge-cache-hit" }), { wrapper });

    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.result.current.facilities[0]?.name).toBe("Oakridge ALF");
  });

  it("refreshes visible facilities after the ttl expires and the tab becomes visible", async () => {
    const { wrapper } = createTestQueryWrapper();
    renderHook(() => useFacilities({ search: "oakridge-cache-stale" }), { wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    nowMs = Date.parse("2026-05-26T12:01:01.000Z");
    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("invalidateFacilitiesCache forces a fresh fetch on the next mount within the ttl", async () => {
    const { wrapper } = createTestQueryWrapper();
    const first = renderHook(() => useFacilities({ search: "oakridge-invalidate" }), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    first.unmount();

    invalidateFacilitiesCache();

    const second = renderHook(() => useFacilities({ search: "oakridge-invalidate" }), { wrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second.result.current.facilities[0]?.name).toBe("Oakridge ALF");
  });
});
