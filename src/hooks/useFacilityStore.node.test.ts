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

describe("useFacilityStore reporting period", () => {
  afterEach(() => { vi.resetModules(); });
  it("stamps the open period on a choice and clears it when the choice changes or resets", async () => {
    const { useFacilityStore } = await import("./useFacilityStore");
    const state = useFacilityStore.getState();
    const a = "00000000-0000-0000-0000-000000000001";
    const b = "00000000-0000-0000-0000-000000000002";
    state.stampSelectionPeriod("2026-09-07");
    expect(useFacilityStore.getState().selectedReportingPeriod).toBeNull();
    state.setSelectedFacility(a); state.stampSelectionPeriod("2026-09-07");
    expect(useFacilityStore.getState().selectedReportingPeriod).toBe("2026-09-07");
    state.stampSelectionPeriod("not a date");
    expect(useFacilityStore.getState().selectedReportingPeriod).toBe("2026-09-07");
    state.setSelectedFacility(b);
    expect(useFacilityStore.getState().selectedReportingPeriod).toBeNull();
    state.stampSelectionPeriod("2026-09-14"); state.resetSelectedFacility();
    expect(useFacilityStore.getState()).toMatchObject({ selectedFacilityId: null, selectedReportingPeriod: null });
  });
  it("keeps a Sunday choice through Monday of the same period and drops it across a month boundary or unknown period", async () => {
    const { selectionBelongsToPeriod } = await import("./useFacilityStore");
    const { reportingWeek } = await import("@/lib/stand-up/model");
    const sunday = reportingWeek(new Date("2026-09-13T16:00:00Z"));
    const monday = reportingWeek(new Date("2026-09-14T13:00:00Z"));
    expect(sunday).toBe("2026-09-14");
    expect(selectionBelongsToPeriod(sunday, monday)).toBe(true);
    expect(selectionBelongsToPeriod(reportingWeek(new Date("2026-09-11T20:00:00Z")), monday)).toBe(false);
    expect(selectionBelongsToPeriod("2026-08-31", reportingWeek(new Date("2026-09-07T13:00:00Z")))).toBe(false);
    expect(selectionBelongsToPeriod("2026-12-28", reportingWeek(new Date("2027-01-04T13:00:00Z")))).toBe(false);
    expect(selectionBelongsToPeriod(null, monday)).toBe(false);
  });
  it("only rehydrates a persisted period together with a valid facility", async () => {
    const stored = { state: { selectedFacilityId: "00000000-0000-0000-0000-000000000001", selectedReportingPeriod: "2026-09-07" }, version: 0 };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => JSON.stringify(stored), setItem: () => {}, removeItem: () => {} } } });
    try {
      const { useFacilityStore } = await import("./useFacilityStore");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(useFacilityStore.getState()).toMatchObject({ selectedFacilityId: stored.state.selectedFacilityId, selectedReportingPeriod: "2026-09-07" });
      vi.resetModules();
      stored.state = { selectedFacilityId: "not-a-uuid", selectedReportingPeriod: "2026-09-07" };
      const fresh = await import("./useFacilityStore");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(fresh.useFacilityStore.getState()).toMatchObject({ selectedFacilityId: null, selectedReportingPeriod: null });
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});
