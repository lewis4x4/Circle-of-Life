/**
 * Floor tablet device replay (COL-690, spec 40 §1 "Offline", §4 "Replay").
 *
 * A rounding check or care event queued offline on a floor tablet carries the
 * `unlockId` it was captured under. The normal owner-only sync sends it only
 * while its owner is signed in; on a shared tablet the next person may unlock
 * first. This path sends those items with the device token instead, to
 * POST /api/floor/replay, which writes each one as its owner.
 *
 * Both queues live in the `haven-offline` IndexedDB the service worker and the
 * in-page care-event queue already use. Delivered and terminally rejected
 * items are removed (nothing clinical stays on a shared tablet); items the
 * server could not write stay for the next pass.
 */

import {
  FLOOR_DEVICE_HEADER,
  FLOOR_REPLAY_ENDPOINT,
  FLOOR_REPLAY_MAX_ITEMS,
  type FloorReplayItem,
  type FloorReplayResponse,
} from "@/lib/floor/contract";
import { resolveFloorDeviceStore, type FloorDeviceStore } from "@/lib/floor/device-store";
import { createIndexedDbQueueStore, createMemoryQueueStore, type CareEventQueueItem } from "@/lib/offline/care-event-queue";
import type { RoundingOfflineQueueItem } from "@/lib/pwa/rounding-sync";

const DB_NAME = "haven-offline";
const DB_VERSION = 2;
const ROUNDING_STORE = "roundingQueue";
const CARE_EVENT_STORE = "careEventQueue";

export interface FloorQueueStore {
  listRounding(): Promise<RoundingOfflineQueueItem[]>;
  deleteRounding(id: string): Promise<void>;
  listCareEvents(): Promise<CareEventQueueItem[]>;
  deleteCareEvent(clientEventId: string): Promise<void>;
}

export function createMemoryFloorQueueStore(seed: { rounding?: RoundingOfflineQueueItem[]; careEvents?: CareEventQueueItem[] } = {}): FloorQueueStore {
  const rounding = new Map((seed.rounding ?? []).map((item) => [item.id, item]));
  const careEvents = createMemoryQueueStore(seed.careEvents ?? []);
  return {
    async listRounding() {
      return [...rounding.values()];
    },
    async deleteRounding(id) {
      rounding.delete(id);
    },
    listCareEvents: () => careEvents.all(),
    deleteCareEvent: (id) => careEvents.delete(id),
  };
}

/** Same database, version and upgrade as public/sw.js and care-event-queue.ts. */
function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROUNDING_STORE)) {
        const store = db.createObjectStore(ROUNDING_STORE, { keyPath: "id" });
        store.createIndex("taskId", "taskId", { unique: false });
      }
      if (!db.objectStoreNames.contains(CARE_EVENT_STORE)) {
        db.createObjectStore(CARE_EVENT_STORE, { keyPath: "clientEventId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withRoundingStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openOfflineDb();
  return await new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(ROUNDING_STORE, mode);
    let result: T | undefined;
    const request = run(transaction.objectStore(ROUNDING_STORE));
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
    }
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
  });
}

export function createIndexedDbFloorQueueStore(): FloorQueueStore {
  const careEvents = createIndexedDbQueueStore();
  return {
    async listRounding() {
      const rows = await withRoundingStore<RoundingOfflineQueueItem[]>("readonly", (store) => store.getAll() as IDBRequest<RoundingOfflineQueueItem[]>);
      return rows ?? [];
    },
    async deleteRounding(id) {
      await withRoundingStore("readwrite", (store) => {
        store.delete(id);
      });
    },
    listCareEvents: () => careEvents.all(),
    deleteCareEvent: (id) => careEvents.delete(id),
  };
}

let defaultStore: FloorQueueStore | null = null;

function resolveQueueStore(store?: FloorQueueStore): FloorQueueStore {
  if (store) return store;
  defaultStore ??= typeof indexedDB !== "undefined" ? createIndexedDbFloorQueueStore() : createMemoryFloorQueueStore();
  return defaultStore;
}

// ---------------------------------------------------------------------------
// Selection (pure)
// ---------------------------------------------------------------------------

/**
 * Items the device replay should send: captured under a floor unlock, and not
 * the signed-in person's (theirs go out through the normal owner sync). With
 * nobody signed in, every floor item qualifies. Caregiver chip-capture checks
 * have no device replay writer and wait for their owner (the floor's own
 * chart, `captureSurface: "floor"`, replays); terminal care events are
 * reconciliation items and are never resent. Oldest first.
 */
export function selectFloorReplayItems(input: {
  rounding: RoundingOfflineQueueItem[];
  careEvents: CareEventQueueItem[];
  signedInUserId: string | null;
}): FloorReplayItem[] {
  const notMine = (owner: string) => !input.signedInUserId || owner !== input.signedInUserId;
  const rounding: FloorReplayItem[] = input.rounding
    .filter((item) => Boolean(item.unlockId) && Boolean(item.ownerUserId) && notMine(item.ownerUserId)
      && (item.payload.chipSelections === undefined || item.payload.captureSurface === "floor"))
    .map((item) => ({
      kind: "rounding",
      client_id: item.id,
      unlock_id: item.unlockId as string,
      owner_user_id: item.ownerUserId,
      captured_at: item.queuedAt,
      task_id: item.taskId,
      payload: { ...item.payload } as Record<string, unknown>,
    }));
  const careEvents: FloorReplayItem[] = input.careEvents
    .filter((item) => Boolean(item.unlockId) && Boolean(item.ownerUserId) && !item.terminal && notMine(item.ownerUserId))
    .map((item) => ({
      kind: "care_event",
      client_id: item.clientEventId,
      unlock_id: item.unlockId as string,
      owner_user_id: item.ownerUserId,
      captured_at: item.queuedAt,
      payload: { ...item.payload, captured_offline: true } as Record<string, unknown>,
    }));
  return [...rounding, ...careEvents].sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0));
}

/**
 * Unsent items on this tablet per owner user id, for the lock screen's
 * "n unsent" pill. Counts both queues; terminal care events are excluded
 * because they will never send on their own.
 */
export function countUnsentByOwnerFrom(input: { rounding: RoundingOfflineQueueItem[]; careEvents: CareEventQueueItem[] }): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (owner: string | null | undefined) => {
    if (owner) counts[owner] = (counts[owner] ?? 0) + 1;
  };
  for (const item of input.rounding) add(item.ownerUserId);
  for (const item of input.careEvents) if (!item.terminal) add(item.ownerUserId);
  return counts;
}

export async function countUnsentByOwner(store?: FloorQueueStore): Promise<Record<string, number>> {
  const queue = resolveQueueStore(store);
  const [rounding, careEvents] = await Promise.all([queue.listRounding(), queue.listCareEvents()]);
  return countUnsentByOwnerFrom({ rounding, careEvents });
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export type FloorReplayRunResult = {
  sent: number;
  rejected: number;
  /** Items the server could not write this time; they stay queued. */
  kept: number;
  /** A network failure, a refused device or a server error stopped the pass. */
  stopped: boolean;
};

let replaying = false;

export async function replayFloorQueues(input: {
  signedInUserId: string | null;
  deviceStore?: FloorDeviceStore;
  queueStore?: FloorQueueStore;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}): Promise<FloorReplayRunResult> {
  const result: FloorReplayRunResult = { sent: 0, rejected: 0, kept: 0, stopped: false };
  if (replaying) return result;
  replaying = true;
  try {
    const device = await resolveFloorDeviceStore(input.deviceStore).getDevice();
    if (!device) return result;
    const queue = resolveQueueStore(input.queueStore);
    const [rounding, careEvents] = await Promise.all([queue.listRounding(), queue.listCareEvents()]);
    const items = selectFloorReplayItems({ rounding, careEvents, signedInUserId: input.signedInUserId });
    const fetchImpl = input.fetchImpl ?? fetch;

    for (let start = 0; start < items.length; start += FLOOR_REPLAY_MAX_ITEMS) {
      const batch = items.slice(start, start + FLOOR_REPLAY_MAX_ITEMS);
      let response: Response;
      try {
        response = await fetchImpl(input.endpoint ?? FLOOR_REPLAY_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", [FLOOR_DEVICE_HEADER]: device.token },
          body: JSON.stringify({ items: batch }),
          // Device-token only: the replay must never ride the current person's session.
          credentials: "omit",
        });
      } catch {
        result.stopped = true;
        result.kept += items.length - start;
        break;
      }
      if (!response.ok) {
        result.stopped = true;
        result.kept += items.length - start;
        break;
      }
      let body: FloorReplayResponse;
      try {
        body = (await response.json()) as FloorReplayResponse;
      } catch {
        result.stopped = true;
        result.kept += items.length - start;
        break;
      }
      const byId = new Map((Array.isArray(body.results) ? body.results : []).map((entry) => [entry.client_id, entry.status]));
      for (const item of batch) {
        const status = byId.get(item.client_id);
        if (status === "sent" || status === "rejected") {
          if (item.kind === "rounding") await queue.deleteRounding(item.client_id);
          else await queue.deleteCareEvent(item.client_id);
          if (status === "sent") result.sent += 1;
          else result.rejected += 1;
        } else {
          result.kept += 1;
        }
      }
    }
    return result;
  } finally {
    replaying = false;
  }
}
