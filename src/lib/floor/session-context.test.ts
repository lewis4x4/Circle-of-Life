import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryQueueStore, queueCareEvent, type CareEventQueueItem } from "@/lib/offline/care-event-queue";

import { clearFloorUnlockId, currentFloorUnlockId, setFloorUnlockId, subscribeFloorUnlockId } from "./session-context";

const UNLOCK = "11111111-1111-4111-8111-111111111111";

function item(unlockId?: string | null): CareEventQueueItem {
  return {
    clientEventId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "u1",
    organizationId: "o1",
    facilityId: "f1",
    payload: {} as CareEventQueueItem["payload"],
    level: "routine" as CareEventQueueItem["level"],
    queuedAt: "2026-09-23T13:00:00Z",
    retryCount: 0,
    lastError: null,
    terminal: false,
    ...(unlockId === undefined ? {} : { unlockId }),
  };
}

afterEach(() => {
  clearFloorUnlockId();
  vi.unstubAllGlobals();
});

describe("floor session context", () => {
  it("holds the unlock id in memory and sessionStorage, never localStorage, and notifies", () => {
    const seen: (string | null)[] = [];
    const stop = subscribeFloorUnlockId((id) => seen.push(id));
    setFloorUnlockId(UNLOCK);
    expect(currentFloorUnlockId()).toBe(UNLOCK);
    expect(window.sessionStorage.getItem("haven-floor-unlock")).toBe(UNLOCK);
    expect(window.localStorage.getItem("haven-floor-unlock")).toBeNull();
    clearFloorUnlockId();
    expect(currentFloorUnlockId()).toBeNull();
    stop();
    expect(seen).toEqual([UNLOCK, null]);
  });

  it("stamps the current unlock on a queued care event, and nothing off a floor tablet", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const store = createMemoryQueueStore();
    await queueCareEvent(item(), { store });
    expect((await store.all())[0]?.unlockId).toBeNull();

    setFloorUnlockId(UNLOCK);
    await queueCareEvent(item(), { store });
    expect((await store.all())[0]?.unlockId).toBe(UNLOCK);

    await queueCareEvent(item("explicit"), { store });
    expect((await store.all())[0]?.unlockId).toBe("explicit");
  });
});
