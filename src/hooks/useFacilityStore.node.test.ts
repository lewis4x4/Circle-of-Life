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
});
