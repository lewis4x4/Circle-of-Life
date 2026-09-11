/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

describe("useFacilityStore SSR import safety", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    vi.resetModules();
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("does not touch Node global localStorage during import and exposes default state", async () => {
    let localStorageTouched = false;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        localStorageTouched = true;
        throw new Error("global localStorage should not be read during SSR import");
      },
    });

    const { useFacilityStore } = await import("./useFacilityStore");

    expect(localStorageTouched).toBe(false);
    expect(useFacilityStore.getState()).toMatchObject({
      selectedFacilityId: null,
      availableFacilities: [],
      facilitiesFetchedAt: null,
      facilitiesCacheUserId: null,
    });
  });

  it("vetoes a user scope change before subscribers observe it and unregisters cleanly", async () => {
    const { useFacilityStore } = await import("./useFacilityStore");
    const state = useFacilityStore.getState();
    const a = "00000000-0000-0000-0000-000000000001";
    const b = "00000000-0000-0000-0000-000000000002";
    expect(state.setSelectedFacility(a)).toBe(true);
    const changes: (string | null)[] = [];
    const stop = useFacilityStore.subscribe(s => { changes.push(s.selectedFacilityId); });
    const guard = vi.fn(() => false);
    const unregister = state.registerFacilityChangeGuard(guard);
    expect(state.setSelectedFacility(b)).toBe(false);
    expect(state.setSelectedFacility(null)).toBe(false);
    expect(useFacilityStore.getState().selectedFacilityId).toBe(a);
    expect(changes).toEqual([]);
    expect(state.setSelectedFacility(a)).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
    unregister();
    expect(state.setSelectedFacility(b)).toBe(true);
    expect(changes).toEqual([b]);
    stop();
  });

  it("allows security invalidation to clear a dirty form's scope", async () => {
    const { useFacilityStore } = await import("./useFacilityStore");
    const state = useFacilityStore.getState();
    state.setSelectedFacility("00000000-0000-0000-0000-000000000001");
    const guard = vi.fn(() => false);
    const unregister = state.registerFacilityChangeGuard(guard);
    state.resetSelectedFacility();
    expect(useFacilityStore.getState().selectedFacilityId).toBeNull();
    expect(guard).not.toHaveBeenCalled();
    unregister();
  });
});
