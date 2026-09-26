import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchFloorRoster: vi.fn() }));
const DEVICE = { deviceId: "d", token: "t", facilityId: "f", facilityName: "Homewood", deviceLabel: "HL-FLOOR-02", enrolledAt: "2026-09-25T00:00:00Z" };
vi.mock("@/lib/floor/device-store", () => ({ resolveFloorDeviceStore: () => ({ getDevice: async () => DEVICE }) }));
vi.mock("@/lib/floor/replay", () => ({ replayFloorQueues: async () => null, countUnsentByOwner: async () => ({}) }));
vi.mock("@/lib/floor/unlock-client", () => ({ fetchFloorRoster: mocks.fetchFloorRoster }));

import { useFloorRoster } from "./useFloorRoster";

const roster = (names: string[]) => ({ ok: true, value: { roster: names.map((n) => ({ staff_id: n, display_name: n })), throttled_until: null } });

beforeEach(() => {
  mocks.fetchFloorRoster.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFloorRoster", () => {
  it("asks again when the tablet wakes, so someone who just clocked in is listed at once", async () => {
    mocks.fetchFloorRoster.mockResolvedValueOnce(roster(["Rita S."])).mockResolvedValue(roster(["Rita S.", "Abbigail H."]));
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    const { result } = renderHook(() => useFloorRoster());
    await waitFor(() => expect(result.current.roster.status).toBe("success-populated"));
    expect(mocks.fetchFloorRoster).toHaveBeenCalledTimes(1);
    // A wake right after the first read does not ask twice.
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.fetchFloorRoster).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 30_000);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    await waitFor(() => expect(mocks.fetchFloorRoster).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const state = result.current.roster;
      expect(state.status === "success-populated" ? state.roster.roster.map((p) => p.display_name) : []).toContain("Abbigail H.");
    });
    now.mockRestore();
  });

  it("asks again every 15 seconds while the lock screen shows", async () => {
    vi.useFakeTimers();
    mocks.fetchFloorRoster.mockResolvedValue(roster(["Rita S."]));
    renderHook(() => useFloorRoster());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const first = mocks.fetchFloorRoster.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });
    expect(mocks.fetchFloorRoster.mock.calls.length).toBe(first + 1);
  });
});
