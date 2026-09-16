/**
 * Offline queue for "Something happened" captures (spec 07A §2 "Offline").
 *
 * Items are keyed by `client_event_id` so a replay of the same capture is
 * idempotent on the server. The payload (resident id and answers) lives in
 * IndexedDB only, like the rounding queue; nothing about the resident is
 * written to localStorage.
 *
 * Transport: when a service worker controls the page the queue is handed to
 * `public/sw.js` (background sync survives the tab). Otherwise the in-page
 * IndexedDB store plus `replayQueuedCareEvents` on `online` carry the load.
 */

import type { CareEventLevel } from "@/lib/care-events/level-engine";
import {
  type CareEventReceipt,
  type CareEventSubmitPayload,
  parseCareEventReceipt,
} from "@/lib/care-events/submit";

export const CARE_EVENT_SUBMIT_ENDPOINT = "/api/care-events/submit";
export const CARE_EVENT_QUEUE_CHANNEL = "haven-care-events";
export const CARE_EVENT_SYNC_TAG = "haven-care-event-sync";

const DB_NAME = "haven-offline";
const DB_VERSION = 2;
const ROUNDING_STORE = "roundingQueue";
const CARE_EVENT_STORE = "careEventQueue";

const QUEUE_COMMAND = "HAVEN_QUEUE_CARE_EVENT";
const FLUSH_COMMAND = "HAVEN_FLUSH_CARE_EVENT_QUEUE";
const STATE_COMMAND = "HAVEN_PING_CARE_EVENT_QUEUE_STATE";
const STATE_EVENT = "HAVEN_CARE_EVENT_QUEUE_STATE";

export type CareEventQueueItem = {
  clientEventId: string;
  ownerUserId: string;
  organizationId: string;
  facilityId: string;
  payload: CareEventSubmitPayload;
  /** Client-derived level, only for the offline receipt's on-call line. */
  level: CareEventLevel;
  queuedAt: string;
  retryCount: number;
  lastError: string | null;
  /** 409 or 422 from the server: keep for reconciliation, never auto-retry. 403 (wrong operator) stays retryable. */
  terminal: boolean;
};

export type CareEventQueueSent = { clientEventId: string; receipt: CareEventReceipt };
export type CareEventQueueFailed = { clientEventId: string; error: string; terminal: boolean };

export type CareEventReplayResult = { sent: CareEventQueueSent[]; failed: CareEventQueueFailed[] };

export type CareEventQueueState = {
  pendingCount: number;
  isSyncing: boolean;
  lastError: string | null;
  /** Receipts for items confirmed by the most recent replay. */
  sent: CareEventQueueSent[];
};

export interface QueueStore {
  put(item: CareEventQueueItem): Promise<void>;
  get(clientEventId: string): Promise<CareEventQueueItem | undefined>;
  delete(clientEventId: string): Promise<void>;
  all(): Promise<CareEventQueueItem[]>;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export function createMemoryQueueStore(seed: CareEventQueueItem[] = []): QueueStore {
  const items = new Map(seed.map((item) => [item.clientEventId, item]));
  return {
    async put(item) {
      items.set(item.clientEventId, item);
    },
    async get(clientEventId) {
      return items.get(clientEventId);
    },
    async delete(clientEventId) {
      items.delete(clientEventId);
    },
    async all() {
      return [...items.values()];
    },
  };
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROUNDING_STORE)) {
        const rounding = db.createObjectStore(ROUNDING_STORE, { keyPath: "id" });
        rounding.createIndex("taskId", "taskId", { unique: false });
      }
      if (!db.objectStoreNames.contains(CARE_EVENT_STORE)) {
        db.createObjectStore(CARE_EVENT_STORE, { keyPath: "clientEventId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withCareEventStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openQueueDb();
  return await new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(CARE_EVENT_STORE, mode);
    const store = transaction.objectStore(CARE_EVENT_STORE);
    let result: T | undefined;
    const request = run(store);
    if (request) request.onsuccess = () => {
      result = request.result;
    };
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

export function supportsIndexedDbQueue(): boolean {
  return typeof indexedDB !== "undefined";
}

export function createIndexedDbQueueStore(): QueueStore {
  return {
    async put(item) {
      await withCareEventStore("readwrite", (store) => {
        store.put(item);
      });
    },
    async get(clientEventId) {
      return await withCareEventStore<CareEventQueueItem | undefined>("readonly", (store) =>
        store.get(clientEventId) as IDBRequest<CareEventQueueItem | undefined>,
      );
    },
    async delete(clientEventId) {
      await withCareEventStore("readwrite", (store) => {
        store.delete(clientEventId);
      });
    },
    async all() {
      const rows = await withCareEventStore<CareEventQueueItem[]>("readonly", (store) =>
        store.getAll() as IDBRequest<CareEventQueueItem[]>,
      );
      return rows ?? [];
    },
  };
}

let defaultStore: QueueStore | null = null;

function resolveStore(store?: QueueStore): QueueStore {
  if (store) return store;
  defaultStore ??= supportsIndexedDbQueue() ? createIndexedDbQueueStore() : createMemoryQueueStore();
  return defaultStore;
}

// ---------------------------------------------------------------------------
// Replay (in-page)
// ---------------------------------------------------------------------------

const inFlight = new Set<string>();

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.clone().json()) as { error?: unknown };
    if (json && typeof json.error === "string") return json.error;
  } catch {
    // fall through to text
  }
  try {
    const text = await response.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return `Request failed (${response.status})`;
}

export async function replayQueuedCareEvents(input: {
  fetchImpl?: typeof fetch;
  store?: QueueStore;
  ownerUserId: string | null;
  endpoint?: string;
}): Promise<CareEventReplayResult> {
  const store = resolveStore(input.store);
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = input.endpoint ?? CARE_EVENT_SUBMIT_ENDPOINT;
  const result: CareEventReplayResult = { sent: [], failed: [] };
  if (!input.ownerUserId) return result;

  const items = (await store.all()).filter(
    (item) => item.ownerUserId === input.ownerUserId && !item.terminal && !inFlight.has(item.clientEventId),
  );

  for (const item of items) {
    inFlight.add(item.clientEventId);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-haven-sync": "page" },
        body: JSON.stringify({ ...item.payload, captured_offline: true, queue_owner_user_id: item.ownerUserId }),
        credentials: "same-origin",
      });
      if (response.ok) {
        const receipt = parseCareEventReceipt(await response.json());
        await store.delete(item.clientEventId);
        result.sent.push({ clientEventId: item.clientEventId, receipt });
        continue;
      }
      const error = await readErrorMessage(response);
      // 403 means the signed-in operator is not the item's owner: retained, not
      // terminal, so the original reporter can send it after signing in.
      const terminal = response.status === 409 || response.status === 422;
      await store.put({ ...item, retryCount: item.retryCount + 1, lastError: error, terminal });
      result.failed.push({ clientEventId: item.clientEventId, error, terminal });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.put({ ...item, retryCount: item.retryCount + 1, lastError: message, terminal: false });
      result.failed.push({ clientEventId: item.clientEventId, error: message, terminal: false });
    } finally {
      inFlight.delete(item.clientEventId);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Service worker transport
// ---------------------------------------------------------------------------

type SyncCapableRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

function controllingWorker(): ServiceWorker | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.controller ?? null;
}

export function hasServiceWorkerTransport(): boolean {
  return controllingWorker() !== null;
}

async function sendWorkerCommand<TResponse>(type: string, payload: Record<string, unknown>): Promise<TResponse> {
  const worker = controllingWorker();
  if (!worker) throw new Error("Service worker is not controlling this page.");
  return await new Promise<TResponse>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => reject(new Error("Service worker command timed out.")), 8000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      const data = event.data as { ok?: boolean; error?: string };
      if (data?.ok === false) {
        reject(new Error(data.error ?? "Service worker command failed."));
        return;
      }
      resolve(event.data as TResponse);
    };
    worker.postMessage({ type, ...payload }, [channel.port2]);
  });
}

async function registerBackgroundSync(): Promise<void> {
  try {
    const registration = (await navigator.serviceWorker.getRegistration()) as SyncCapableRegistration | undefined;
    await registration?.sync?.register(CARE_EVENT_SYNC_TAG);
  } catch {
    // Background sync is optional; the online flush still runs.
  }
}

type WorkerStatePayload = { pendingCount: number; lastError: string | null; sent?: CareEventQueueSent[] };

// ---------------------------------------------------------------------------
// Public queue API
// ---------------------------------------------------------------------------

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export async function queueCareEvent(item: CareEventQueueItem, options: { store?: QueueStore } = {}): Promise<void> {
  if (!options.store && hasServiceWorkerTransport()) {
    await sendWorkerCommand(QUEUE_COMMAND, { item, ownerUserId: item.ownerUserId });
    await registerBackgroundSync();
    if (isOnline()) void flushCareEventQueue({ ownerUserId: item.ownerUserId });
    return;
  }
  await resolveStore(options.store).put(item);
  if (isOnline()) void flushCareEventQueue({ ownerUserId: item.ownerUserId, store: options.store });
}

export async function listQueuedCareEvents(ownerUserId: string, store?: QueueStore): Promise<CareEventQueueItem[]> {
  return (await resolveStore(store).all()).filter((item) => item.ownerUserId === ownerUserId);
}

export async function removeQueuedCareEvent(clientEventId: string, store?: QueueStore): Promise<void> {
  await resolveStore(store).delete(clientEventId);
}

export async function queueSizeForOwner(ownerUserId: string, store?: QueueStore): Promise<number> {
  return (await listQueuedCareEvents(ownerUserId, store)).filter((item) => !item.terminal).length;
}

let flushing = false;

/** Replay through the service worker when it controls the page, otherwise in-page. */
export async function flushCareEventQueue(input: {
  ownerUserId: string | null;
  store?: QueueStore;
  fetchImpl?: typeof fetch;
}): Promise<CareEventQueueState> {
  if (!input.ownerUserId) return { pendingCount: 0, isSyncing: false, lastError: null, sent: [] };
  if (flushing) return { pendingCount: await queueSizeForOwner(input.ownerUserId, input.store), isSyncing: true, lastError: null, sent: [] };
  flushing = true;
  try {
    if (!input.store && hasServiceWorkerTransport()) {
      const response = await sendWorkerCommand<{ ok: true; state: WorkerStatePayload }>(FLUSH_COMMAND, {
        ownerUserId: input.ownerUserId,
      });
      const state: CareEventQueueState = {
        pendingCount: response.state.pendingCount,
        isSyncing: false,
        lastError: response.state.lastError,
        sent: response.state.sent ?? [],
      };
      notifyLocal(state);
      return state;
    }
    const result = await replayQueuedCareEvents({
      fetchImpl: input.fetchImpl,
      store: input.store,
      ownerUserId: input.ownerUserId,
    });
    const state: CareEventQueueState = {
      pendingCount: await queueSizeForOwner(input.ownerUserId, input.store),
      isSyncing: false,
      lastError: result.failed.find((entry) => entry.error)?.error ?? null,
      sent: result.sent,
    };
    notifyLocal(state);
    broadcast(state);
    return state;
  } finally {
    flushing = false;
  }
}

export async function requestCareEventQueueState(ownerUserId: string | null, store?: QueueStore): Promise<CareEventQueueState> {
  if (!ownerUserId) return { pendingCount: 0, isSyncing: false, lastError: null, sent: [] };
  if (!store && hasServiceWorkerTransport()) {
    try {
      const response = await sendWorkerCommand<{ ok: true; state: WorkerStatePayload }>(STATE_COMMAND, { ownerUserId });
      return {
        pendingCount: response.state.pendingCount,
        isSyncing: false,
        lastError: response.state.lastError,
        sent: response.state.sent ?? [],
      };
    } catch {
      // fall back to the shared IndexedDB store below
    }
  }
  const items = await listQueuedCareEvents(ownerUserId, store);
  return {
    pendingCount: items.filter((item) => !item.terminal).length,
    isSyncing: false,
    lastError: items.find((item) => item.lastError)?.lastError ?? null,
    sent: [],
  };
}

// ---------------------------------------------------------------------------
// Subscriptions: BroadcastChannel + service worker messages + online
// ---------------------------------------------------------------------------

type Listener = (state: CareEventQueueState) => void;
const localListeners = new Set<Listener>();

function notifyLocal(state: CareEventQueueState): void {
  for (const listener of localListeners) listener(state);
}

function broadcast(state: CareEventQueueState): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CARE_EVENT_QUEUE_CHANNEL);
    channel.postMessage({ type: STATE_EVENT, state });
    channel.close();
  } catch {
    // Other tabs simply poll on their next online event.
  }
}

function stateFromMessage(data: unknown): CareEventQueueState | null {
  if (!data || typeof data !== "object") return null;
  const message = data as { type?: unknown; state?: unknown };
  if (message.type !== STATE_EVENT || !message.state || typeof message.state !== "object") return null;
  const state = message.state as Partial<WorkerStatePayload> & { isSyncing?: boolean };
  return {
    pendingCount: typeof state.pendingCount === "number" ? state.pendingCount : 0,
    isSyncing: state.isSyncing === true,
    lastError: typeof state.lastError === "string" ? state.lastError : null,
    sent: Array.isArray(state.sent) ? state.sent : [],
  };
}

export function subscribeCareEventQueue(
  callback: Listener,
  options: { ownerUserId: string | null; store?: QueueStore; fetchImpl?: typeof fetch } = { ownerUserId: null },
): () => void {
  localListeners.add(callback);
  const disposers: (() => void)[] = [() => localListeners.delete(callback)];

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CARE_EVENT_QUEUE_CHANNEL);
    channel.onmessage = (event) => {
      const state = stateFromMessage(event.data);
      if (state) callback(state);
    };
    disposers.push(() => channel.close());
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const handler = (event: MessageEvent) => {
      const state = stateFromMessage(event.data);
      if (state) callback(state);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    disposers.push(() => navigator.serviceWorker.removeEventListener("message", handler));
  }

  if (typeof window !== "undefined") {
    const handleOnline = () => {
      void flushCareEventQueue({ ownerUserId: options.ownerUserId, store: options.store, fetchImpl: options.fetchImpl });
    };
    window.addEventListener("online", handleOnline);
    disposers.push(() => window.removeEventListener("online", handleOnline));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}
