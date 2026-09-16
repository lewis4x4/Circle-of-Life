/**
 * Kiosk device token and offline punch queue (COL-352, spec 37 §5).
 *
 * The device token and queued punches live in IndexedDB (`haven-timeclock`).
 * The PIN for a queued punch lives only in page memory (`pinMemory`): a reload
 * loses it, and the server records that replay as `pin_unavailable` for the
 * manager. Nothing typed on the kiosk is written to localStorage.
 */

import { KIOSK_DEVICE_HEADER, KIOSK_PUNCH_ENDPOINT, type KioskPunchRequest, type PunchType } from "@/lib/timeclock/kiosk-contract";

const DB_NAME = "haven-timeclock";
const DB_VERSION = 1;
const DEVICE_STORE = "device";
const QUEUE_STORE = "punchQueue";
const DEVICE_KEY = "device";

/** Queued punches older than this are dropped at replay; the gap surfaces as a missing punch. */
export const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type KioskDevice = {
  key?: string;
  token: string;
  facilityId: string;
  facilityName: string;
  enrolledAt: string;
};

export type QueuedPunch = {
  clientPunchId: string;
  identifier: string;
  punchType: PunchType;
  /** Device wall clock at capture, ISO. Becomes the punch time on the server. */
  deviceTime: string;
  queuedAt: string;
};

export interface KioskStore {
  getDevice(): Promise<KioskDevice | null>;
  setDevice(device: KioskDevice): Promise<void>;
  clearDevice(): Promise<void>;
  enqueue(item: QueuedPunch): Promise<void>;
  dequeue(clientPunchId: string): Promise<void>;
  /** Oldest first. */
  listQueue(): Promise<QueuedPunch[]>;
}

/** PIN by client punch id, page memory only. */
export const pinMemory = new Map<string, string>();

function sortQueue(items: QueuedPunch[]): QueuedPunch[] {
  return [...items].sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0));
}

export function createMemoryKioskStore(seed: { device?: KioskDevice | null; queue?: QueuedPunch[] } = {}): KioskStore {
  let device: KioskDevice | null = seed.device ?? null;
  const queue = new Map((seed.queue ?? []).map((item) => [item.clientPunchId, item]));
  return {
    async getDevice() {
      return device;
    },
    async setDevice(next) {
      device = next;
    },
    async clearDevice() {
      device = null;
    },
    async enqueue(item) {
      queue.set(item.clientPunchId, item);
    },
    async dequeue(id) {
      queue.delete(id);
    },
    async listQueue() {
      return sortQueue([...queue.values()]);
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "clientPunchId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return await new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result: T | undefined;
    const request = run(store);
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

export function supportsIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

export function createIndexedDbKioskStore(): KioskStore {
  return {
    async getDevice() {
      const row = await withStore<KioskDevice | undefined>(DEVICE_STORE, "readonly", (store) => store.get(DEVICE_KEY) as IDBRequest<KioskDevice | undefined>);
      return row ?? null;
    },
    async setDevice(device) {
      await withStore(DEVICE_STORE, "readwrite", (store) => {
        store.put({ ...device, key: DEVICE_KEY });
      });
    },
    async clearDevice() {
      await withStore(DEVICE_STORE, "readwrite", (store) => {
        store.delete(DEVICE_KEY);
      });
    },
    async enqueue(item) {
      await withStore(QUEUE_STORE, "readwrite", (store) => {
        store.put(item);
      });
    },
    async dequeue(id) {
      await withStore(QUEUE_STORE, "readwrite", (store) => {
        store.delete(id);
      });
    },
    async listQueue() {
      const rows = await withStore<QueuedPunch[]>(QUEUE_STORE, "readonly", (store) => store.getAll() as IDBRequest<QueuedPunch[]>);
      return sortQueue(rows ?? []);
    },
  };
}

let defaultStore: KioskStore | null = null;

export function resolveKioskStore(store?: KioskStore): KioskStore {
  if (store) return store;
  defaultStore ??= supportsIndexedDb() ? createIndexedDbKioskStore() : createMemoryKioskStore();
  return defaultStore;
}

export type ReplayResult = {
  sent: number;
  /** Server refused the punch (4xx); it is recorded for the manager, never shown on the kiosk. */
  rejected: number;
  dropped: number;
  /** A network or 5xx failure stopped the replay so order is preserved. */
  stopped: boolean;
};

let replaying = false;

/**
 * Replay queued punches in capture order. Stops at the first network failure
 * so a later punch never lands before an earlier one. Any 4xx removes the item:
 * the server has recorded a sync rejection for the manager exception list.
 */
export async function replayKioskQueue(input: {
  store?: KioskStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  endpoint?: string;
}): Promise<ReplayResult> {
  const result: ReplayResult = { sent: 0, rejected: 0, dropped: 0, stopped: false };
  if (replaying) return result;
  replaying = true;
  try {
    const store = resolveKioskStore(input.store);
    const fetchImpl = input.fetchImpl ?? fetch;
    const now = input.now ?? (() => new Date());
    const device = await store.getDevice();
    if (!device) return result;
    const items = await store.listQueue();
    for (const item of items) {
      if (now().getTime() - new Date(item.queuedAt).getTime() > QUEUE_MAX_AGE_MS) {
        await store.dequeue(item.clientPunchId);
        pinMemory.delete(item.clientPunchId);
        result.dropped += 1;
        continue;
      }
      const body: KioskPunchRequest = {
        identifier: item.identifier,
        pin: pinMemory.get(item.clientPunchId) ?? "",
        punch_type: item.punchType,
        device_time: item.deviceTime,
        client_punch_id: item.clientPunchId,
        captured_offline: true,
      };
      let response: Response;
      try {
        response = await fetchImpl(input.endpoint ?? KIOSK_PUNCH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", [KIOSK_DEVICE_HEADER]: device.token },
          body: JSON.stringify(body),
          credentials: "omit",
        });
      } catch {
        result.stopped = true;
        break;
      }
      if (response.ok) {
        await store.dequeue(item.clientPunchId);
        pinMemory.delete(item.clientPunchId);
        result.sent += 1;
        continue;
      }
      if (response.status >= 400 && response.status < 500) {
        await store.dequeue(item.clientPunchId);
        pinMemory.delete(item.clientPunchId);
        result.rejected += 1;
        continue;
      }
      result.stopped = true;
      break;
    }
    return result;
  } finally {
    replaying = false;
  }
}
