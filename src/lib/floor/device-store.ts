/**
 * Floor tablet device token (COL-690, spec 40 §5).
 *
 * The token is the only secret on the tablet. It lives in IndexedDB
 * (`haven-floor`), never in localStorage, and enrollment asks the browser to
 * keep that storage (`navigator.storage.persist()`) so iOS does not evict it
 * and silently un-enroll the tablet.
 */

import { FLOOR_DEVICE_HEADER } from "@/lib/floor/contract";

const DB_NAME = "haven-floor";
const DB_VERSION = 1;
const DEVICE_STORE = "device";
const DEVICE_KEY = "device";

export type FloorDevice = {
  key?: string;
  deviceId: string;
  token: string;
  facilityId: string;
  facilityName: string;
  deviceLabel: string;
  enrolledAt: string;
};

export interface FloorDeviceStore {
  getDevice(): Promise<FloorDevice | null>;
  setDevice(device: FloorDevice): Promise<void>;
  clearDevice(): Promise<void>;
}

export function createMemoryFloorDeviceStore(seed: FloorDevice | null = null): FloorDeviceStore {
  let device = seed;
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
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withDeviceStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return await new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(DEVICE_STORE, mode);
    const store = transaction.objectStore(DEVICE_STORE);
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

export function createIndexedDbFloorDeviceStore(): FloorDeviceStore {
  return {
    async getDevice() {
      const row = await withDeviceStore<FloorDevice | undefined>("readonly", (store) => store.get(DEVICE_KEY) as IDBRequest<FloorDevice | undefined>);
      return row ?? null;
    },
    async setDevice(device) {
      await withDeviceStore("readwrite", (store) => {
        store.put({ ...device, key: DEVICE_KEY });
      });
    },
    async clearDevice() {
      await withDeviceStore("readwrite", (store) => {
        store.delete(DEVICE_KEY);
      });
    },
  };
}

/**
 * A non-secret value kept beside the device token in the same IndexedDB store
 * (its own key, so no schema upgrade). Used for building configuration only,
 * never for anything about a resident or a person.
 */
export async function readFloorDeviceValue<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined" || key === DEVICE_KEY) return null;
  try {
    const row = await withDeviceStore<{ key: string; value: T } | undefined>("readonly", (store) => store.get(key) as IDBRequest<{ key: string; value: T } | undefined>);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function writeFloorDeviceValue<T>(key: string, value: T): Promise<void> {
  if (typeof indexedDB === "undefined" || key === DEVICE_KEY) return;
  try {
    await withDeviceStore("readwrite", (store) => {
      store.put({ key, value });
    });
  } catch {
    // Only costs the offline convenience it backs.
  }
}

let defaultStore: FloorDeviceStore | null = null;

export function resolveFloorDeviceStore(store?: FloorDeviceStore): FloorDeviceStore {
  if (store) return store;
  defaultStore ??= typeof indexedDB !== "undefined" ? createIndexedDbFloorDeviceStore() : createMemoryFloorDeviceStore();
  return defaultStore;
}

/**
 * Ask the browser to keep this origin's storage. Best effort: returns false
 * when the API is missing or the browser declines; enrollment still succeeds.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Save the enrolled device and ask for persistent storage. */
export async function saveEnrolledFloorDevice(device: FloorDevice, store?: FloorDeviceStore): Promise<{ persisted: boolean }> {
  await resolveFloorDeviceStore(store).setDevice(device);
  return { persisted: await requestPersistentStorage() };
}

/** Headers for a floor API call from this tablet, or null when it is not enrolled. */
export async function floorDeviceHeaders(store?: FloorDeviceStore): Promise<Record<string, string> | null> {
  const device = await resolveFloorDeviceStore(store).getDevice();
  if (!device) return null;
  return { [FLOOR_DEVICE_HEADER]: device.token };
}
