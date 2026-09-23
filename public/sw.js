/* Minimal PWA service worker with caregiver rounds queue, care event queue, and background sync. */

const DB_NAME = "haven-offline";
const DB_VERSION = 2;
const STORE_NAME = "roundingQueue";
const CARE_EVENT_STORE_NAME = "careEventQueue";
const SYNC_TAG = "haven-rounding-sync";
const CARE_EVENT_SYNC_TAG = "haven-care-event-sync";
const CARE_EVENT_SUBMIT_ENDPOINT = "/api/care-events/submit";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ["haven-static-v3", "haven-runtime-v3", "haven-rounding-v3", "haven-static-v4", "haven-static-v5"].includes(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
    await broadcastSyncState();
  })());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Haven", body: "", url: "/" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.openWindow(url));
});

// No fetch handler, on purpose (COL-674). A handler that answers nothing still
// makes the browser start this worker and route every page, RSC and API request
// through it. Authenticated HTML and API responses must never be cached here.

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
    return;
  }
  if (event.tag === CARE_EVENT_SYNC_TAG) {
    // Background sync has no page and no signed-in operator to filter by; the
    // owner travels in the body and the server refuses a mismatch with 403.
    event.waitUntil(flushCareEventQueue(null));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === "HAVEN_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (data.type === "HAVEN_QUEUE_ROUNDING_COMPLETION") {
    event.waitUntil((async () => {
      try {
        await putQueueItem(data.item);
        await broadcastSyncState();
        const state = await buildSyncState({}, data.item.ownerUserId);
        if (port) port.postMessage({ ok: true, state });
      } catch (error) {
        if (port) port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })());
    return;
  }

  if (data.type === "HAVEN_PING_ROUNDING_SYNC_STATE") {
    event.waitUntil((async () => {
      const state = await buildSyncState({}, data.ownerUserId);
      if (port) port.postMessage({ ok: true, state });
    })());
    return;
  }

  if (data.type === "HAVEN_FLUSH_ROUNDING_QUEUE") {
    event.waitUntil((async () => {
      try {
        await flushQueue(data.ownerUserId || null);
        const state = await buildSyncState({}, data.ownerUserId);
        if (port) port.postMessage({ ok: true, state });
      } catch (error) {
        if (port) port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })());
    return;
  }

  if (data.type === "HAVEN_QUEUE_CARE_EVENT") {
    event.waitUntil((async () => {
      try {
        if (!data.item || !data.item.clientEventId || !data.item.ownerUserId || data.item.ownerUserId !== data.ownerUserId) {
          throw new Error("The care event is missing its original operator. Keep it on this screen and sign in again.");
        }
        await putCareEventQueueItem(data.item);
        const state = await buildCareEventQueueState({}, data.ownerUserId);
        if (port) port.postMessage({ ok: true, state });
        await broadcastCareEventQueueState({});
      } catch (error) {
        if (port) port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })());
    return;
  }

  if (data.type === "HAVEN_PING_CARE_EVENT_QUEUE_STATE") {
    event.waitUntil((async () => {
      const state = await buildCareEventQueueState({}, data.ownerUserId);
      if (port) port.postMessage({ ok: true, state });
    })());
    return;
  }

  if (data.type === "HAVEN_FLUSH_CARE_EVENT_QUEUE") {
    event.waitUntil((async () => {
      try {
        const result = await flushCareEventQueue(data.ownerUserId || null);
        const state = await buildCareEventQueueState({ sent: result.sent, lastError: result.lastError }, data.ownerUserId);
        if (port) port.postMessage({ ok: true, state });
      } catch (error) {
        if (port) port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })());
  }
});

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("taskId", "taskId", { unique: false });
      }
      if (!db.objectStoreNames.contains(CARE_EVENT_STORE_NAME)) {
        db.createObjectStore(CARE_EVENT_STORE_NAME, { keyPath: "clientEventId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

async function withStore(mode, callback, storeName = STORE_NAME) {
  const db = await openQueueDb();
  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;

    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("IndexedDB transaction failed"));
    };

    callback(store, (value) => {
      result = value;
    });
  });
}

async function putQueueItem(item) {
  return await withStore("readwrite", (store) => {
    store.put(item);
  });
}

async function deleteQueueItem(id) {
  return await withStore("readwrite", (store) => {
    store.delete(id);
  });
}

async function getAllQueueItems() {
  return await withStore("readonly", (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => setResult(request.result || []);
  });
}

async function buildSyncState(extra = {}, ownerUserId = null) {
  const allItems = await getAllQueueItems();
  const items = ownerUserId ? allItems.filter((item) => item.ownerUserId === ownerUserId) : [];
  return {
    pendingCount: items.length,
    queuedTaskIds: items.map((item) => item.taskId),
    isSyncing: Boolean(extra.isSyncing),
    lastSyncedAt: extra.lastSyncedAt || null,
    lastError: extra.lastError || items.find((item) => item.lastError)?.lastError || null,
    items: items.map(({ id, taskId, residentId, facilityId, queuedAt, lastError, payload }) => ({ id, taskId, residentId, facilityId, queuedAt, lastError, payload })),
  };
}

async function broadcastSyncState(extra = {}) {
  const state = await buildSyncState(extra);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: "HAVEN_ROUNDING_SYNC_STATE",
      // Refresh each window through its own operator-scoped request.

    });
  }
  return state;
}

async function readError(response) {
  try {
    const json = await response.json();
    if (json && typeof json.error === "string") return json.error;
  } catch {
    // ignore
  }
  try {
    return await response.text();
  } catch {
    return `Request failed (${response.status})`;
  }
}

let flushPromise = null;

/**
 * Replay the rounding queue with the page's session. `ownerUserId` is the
 * signed-in operator for a page-driven flush. An item captured on a shared
 * floor tablet carries `unlockId` (COL-690); when it belongs to someone else
 * it is skipped here and goes out through the device replay
 * (src/lib/floor/replay.ts, POST /api/floor/replay) as its owner instead.
 */
async function flushQueue(ownerUserId = null) {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    await broadcastSyncState({ isSyncing: true });

    const items = await getAllQueueItems();
    let lastError = null;
    let sent = false;
    for (const item of items) {
      if (ownerUserId && item.unlockId && item.ownerUserId !== ownerUserId) continue;
      try {
        if (!item.ownerUserId) {
          item.lastError = "Original operator is unknown. Retained for manual reconciliation.";
          await putQueueItem(item);
          continue;
        }
        const response = await fetch(`/api/rounding/tasks/${encodeURIComponent(item.taskId)}/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-haven-sync": "service-worker",
          },
          body: JSON.stringify({ ...item.payload, requestId: item.payload.requestId || item.id, offline: { ownerUserId: item.ownerUserId, organizationId: item.organizationId, facilityId: item.facilityId, queueId: item.id }, observedAt: item.payload.observedAt || item.queuedAt }),
          credentials: "same-origin",
        });

        if (response.ok) {
          await deleteQueueItem(item.id);
          sent = true;
          continue;
        }

        lastError = await readError(response);
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = lastError;
        await putQueueItem(item);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = lastError;
        await putQueueItem(item);
      }
    }

    const finalState = await broadcastSyncState({
      isSyncing: false,
      lastSyncedAt: sent ? new Date().toISOString() : null,
      lastError,
    });
    flushPromise = null;
    return finalState;
  })();

  try { return await flushPromise; } finally { flushPromise = null; }
}

/* ---------------------------------------------------------------------------
 * Care event queue ("Something happened", spec 07A). Keyed by clientEventId so
 * the server replay is idempotent. 409 and 422 are terminal: the item stays for
 * reconciliation and is never retried automatically. 403 (the queue owner is
 * not the signed-in operator) is retained but not terminal: the original
 * reporter may sign in later and the item goes out then.
 * ------------------------------------------------------------------------- */

async function putCareEventQueueItem(item) {
  return await withStore("readwrite", (store) => {
    store.put(item);
  }, CARE_EVENT_STORE_NAME);
}

async function deleteCareEventQueueItem(clientEventId) {
  return await withStore("readwrite", (store) => {
    store.delete(clientEventId);
  }, CARE_EVENT_STORE_NAME);
}

async function getAllCareEventQueueItems() {
  return await withStore("readonly", (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => setResult(request.result || []);
  }, CARE_EVENT_STORE_NAME);
}

async function buildCareEventQueueState(extra = {}, ownerUserId = null) {
  const allItems = await getAllCareEventQueueItems();
  const items = ownerUserId ? allItems.filter((item) => item.ownerUserId === ownerUserId) : [];
  const pending = items.filter((item) => !item.terminal);
  return {
    pendingCount: pending.length,
    isSyncing: Boolean(extra.isSyncing),
    lastError: extra.lastError || items.find((item) => item.lastError)?.lastError || null,
    sent: Array.isArray(extra.sent) ? extra.sent : [],
  };
}

async function broadcastCareEventQueueState(extra = {}) {
  const allItems = await getAllCareEventQueueItems();
  const state = {
    pendingCount: allItems.filter((item) => !item.terminal).length,
    isSyncing: Boolean(extra.isSyncing),
    lastError: extra.lastError || null,
    sent: Array.isArray(extra.sent) ? extra.sent : [],
  };
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "HAVEN_CARE_EVENT_QUEUE_STATE", state });
  }
  return state;
}

let careEventFlushPromise = null;

/**
 * Replay the queue. `ownerUserId` is the signed-in operator for a page-driven
 * flush: items that belong to someone else are left untouched, exactly like
 * the in-page twin in src/lib/offline/care-event-queue.ts. A background sync
 * passes null (no page, no operator) and every item carries its own
 * `queue_owner_user_id` so the server can refuse a mismatch.
 */
async function flushCareEventQueue(ownerUserId = null) {
  if (careEventFlushPromise) return careEventFlushPromise;

  careEventFlushPromise = (async () => {
    await broadcastCareEventQueueState({ isSyncing: true });

    const items = await getAllCareEventQueueItems();
    const sent = [];
    let lastError = null;
    for (const item of items) {
      if (item.terminal) continue;
      // Also covers floor items (unlockId): another person's go out through
      // the device replay (src/lib/floor/replay.ts).
      if (ownerUserId && item.ownerUserId !== ownerUserId) continue;
      try {
        if (!item.ownerUserId) {
          item.lastError = "Original operator is unknown. Retained for manual reconciliation.";
          await putCareEventQueueItem(item);
          continue;
        }
        const response = await fetch(CARE_EVENT_SUBMIT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-haven-sync": "service-worker",
          },
          body: JSON.stringify({ ...item.payload, captured_offline: true, queue_owner_user_id: item.ownerUserId }),
          credentials: "same-origin",
        });

        if (response.ok) {
          let receipt = null;
          try {
            receipt = await response.json();
          } catch {
            receipt = null;
          }
          await deleteCareEventQueueItem(item.clientEventId);
          sent.push({ clientEventId: item.clientEventId, receipt });
          continue;
        }

        lastError = await readError(response);
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = lastError;
        // 403 is deliberately not terminal: the owner may sign in later.
        item.terminal = response.status === 409 || response.status === 422;
        await putCareEventQueueItem(item);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = lastError;
        await putCareEventQueueItem(item);
      }
    }

    await broadcastCareEventQueueState({ isSyncing: false, lastError, sent });
    return { sent, lastError };
  })();

  try { return await careEventFlushPromise; } finally { careEventFlushPromise = null; }
}
