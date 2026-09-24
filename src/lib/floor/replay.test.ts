import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CareEventQueueItem } from "@/lib/offline/care-event-queue";
import type { RoundingOfflineQueueItem } from "@/lib/pwa/rounding-sync";

import { FLOOR_DEVICE_HEADER, FLOOR_REPLAY_MAX_ITEMS } from "./contract";
import { createMemoryFloorDeviceStore } from "./device-store";
import { countUnsentByOwnerFrom, createMemoryFloorQueueStore, replayFloorQueues, selectFloorReplayItems } from "./replay";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNLOCK_A = "11111111-1111-4111-8111-111111111111";
const DEVICE = { deviceId: "d1", token: "floor-token", facilityId: "f1", facilityName: "Synthetic facility", deviceLabel: "Floor 01", enrolledAt: "2026-09-23T10:00:00Z" };

function round(id: string, owner: string, unlockId: string | null, minute: number, extra: Partial<RoundingOfflineQueueItem["payload"]> = {}): RoundingOfflineQueueItem {
  const at = `2026-09-23T13:${String(minute).padStart(2, "0")}:00.000Z`;
  return {
    id,
    taskId: `task-${id}`,
    residentId: "r1",
    ownerUserId: owner,
    organizationId: "o1",
    facilityId: "f1",
    payload: { requestId: id, observedAt: at, quickStatus: "asleep", ...extra },
    queuedAt: at,
    retryCount: 0,
    lastError: null,
    unlockId,
  };
}

function event(id: string, owner: string, unlockId: string | null, minute: number, terminal = false): CareEventQueueItem {
  const at = `2026-09-23T13:${String(minute).padStart(2, "0")}:00.000Z`;
  return {
    clientEventId: id,
    ownerUserId: owner,
    organizationId: "o1",
    facilityId: "f1",
    payload: { client_event_id: id, facility_id: "f1", kind: "fall" } as unknown as CareEventQueueItem["payload"],
    level: "routine" as CareEventQueueItem["level"],
    queuedAt: at,
    retryCount: 0,
    lastError: null,
    terminal,
    unlockId,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("selectFloorReplayItems", () => {
  it("picks floor items that are not the signed-in person's, oldest first", () => {
    const items = selectFloorReplayItems({
      rounding: [round("r2", A, UNLOCK_A, 5), round("r1", A, UNLOCK_A, 1), round("mine", B, "u-b", 2), round("phone", A, null, 3)],
      careEvents: [event("e1", A, UNLOCK_A, 4), event("e-mine", B, "u-b", 6)],
      signedInUserId: B,
    });
    expect(items.map((i) => i.client_id)).toEqual(["r1", "e1", "r2"]);
    expect(items[0]).toMatchObject({ kind: "rounding", unlock_id: UNLOCK_A, owner_user_id: A, captured_at: "2026-09-23T13:01:00.000Z", task_id: "task-r1" });
    expect(items[1]).toMatchObject({ kind: "care_event", payload: { captured_offline: true } });
  });

  it("with nobody signed in, sends every floor item", () => {
    const items = selectFloorReplayItems({ rounding: [round("r1", A, UNLOCK_A, 1), round("r2", B, "u-b", 2)], careEvents: [], signedInUserId: null });
    expect(items.map((i) => i.client_id)).toEqual(["r1", "r2"]);
  });

  it("leaves chip-capture checks and terminal care events for their owner", () => {
    const items = selectFloorReplayItems({
      rounding: [round("chips", A, UNLOCK_A, 1, { chipSelections: { mood: ["calm"] } })],
      careEvents: [event("done", A, UNLOCK_A, 2, true)],
      signedInUserId: null,
    });
    expect(items).toEqual([]);
  });
});

describe("countUnsentByOwnerFrom", () => {
  it("counts both queues per owner, skipping terminal care events", () => {
    expect(countUnsentByOwnerFrom({
      rounding: [round("r1", A, UNLOCK_A, 1), round("r2", A, null, 2), round("r3", B, "u", 3)],
      careEvents: [event("e1", A, UNLOCK_A, 4), event("e2", A, UNLOCK_A, 5, true)],
    })).toEqual({ [A]: 3, [B]: 1 });
  });
});

describe("replayFloorQueues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts with the device token and no session, removes sent and rejected, keeps retry", async () => {
    const queueStore = createMemoryFloorQueueStore({
      rounding: [round("r1", A, UNLOCK_A, 1), round("r2", A, UNLOCK_A, 2)],
      careEvents: [event("e1", A, UNLOCK_A, 3)],
    });
    const fetchImpl = vi.fn(async () => json(200, { results: [
      { client_id: "r1", status: "sent" },
      { client_id: "r2", status: "retry", error: "unavailable" },
      { client_id: "e1", status: "rejected", error: "outside_unlock" },
    ] }));
    const result = await replayFloorQueues({
      signedInUserId: B,
      deviceStore: createMemoryFloorDeviceStore(DEVICE),
      queueStore,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: 1, rejected: 1, kept: 1, stopped: false });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)[FLOOR_DEVICE_HEADER]).toBe("floor-token");
    expect(init.credentials).toBe("omit");
    expect((await queueStore.listRounding()).map((i) => i.id)).toEqual(["r2"]);
    expect(await queueStore.listCareEvents()).toEqual([]);
  });

  it("keeps everything and stops on a network failure or a refused device", async () => {
    const queueStore = createMemoryFloorQueueStore({ rounding: [round("r1", A, UNLOCK_A, 1)] });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await replayFloorQueues({ signedInUserId: null, deviceStore: createMemoryFloorDeviceStore(DEVICE), queueStore, fetchImpl: offline as unknown as typeof fetch }))
      .toEqual({ sent: 0, rejected: 0, kept: 1, stopped: true });
    const revoked = vi.fn(async () => json(401, { error: "device_unknown" }));
    expect((await replayFloorQueues({ signedInUserId: null, deviceStore: createMemoryFloorDeviceStore(DEVICE), queueStore, fetchImpl: revoked as unknown as typeof fetch })).stopped).toBe(true);
    expect(await queueStore.listRounding()).toHaveLength(1);
  });

  it("sends a long queue in batches", async () => {
    const rounding = Array.from({ length: FLOOR_REPLAY_MAX_ITEMS + 3 }, (_, i) => round(`r${i}`, A, UNLOCK_A, i % 60));
    const queueStore = createMemoryFloorQueueStore({ rounding });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { items: { client_id: string }[] };
      return json(200, { results: body.items.map((item) => ({ client_id: item.client_id, status: "sent" })) });
    });
    const result = await replayFloorQueues({ signedInUserId: null, deviceStore: createMemoryFloorDeviceStore(DEVICE), queueStore, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(FLOOR_REPLAY_MAX_ITEMS + 3);
    expect(await queueStore.listRounding()).toEqual([]);
  });

  it("does nothing on a tablet that is not enrolled", async () => {
    const fetchImpl = vi.fn();
    const result = await replayFloorQueues({
      signedInUserId: null,
      deviceStore: createMemoryFloorDeviceStore(null),
      queueStore: createMemoryFloorQueueStore({ rounding: [round("r1", A, UNLOCK_A, 1)] }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.sent).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
