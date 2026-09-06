/* Minimal PWA service worker with caregiver rounds queue + background sync. */

const STATIC_CACHE = "haven-static-v4";
const DB_NAME = "haven-offline";
const STORE_NAME = "roundingQueue";
const SYNC_TAG = "haven-rounding-sync";
const STATIC_ASSETS = ["/manifest.webmanifest", "/icon.svg", "/apple-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ["haven-static-v3", "haven-runtime-v3", "haven-rounding-v3"].includes(key))
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Authenticated HTML and API responses must not survive an operator change.

});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushQueue());
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

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
        await flushQueue();
        const state = await buildSyncState({}, data.ownerUserId);
        if (port) port.postMessage({ ok: true, state });
      } catch (error) {
        if (port) port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })());
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("taskId", "taskId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

async function withStore(mode, callback) {
  const db = await openQueueDb();
  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
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

async function flushQueue() {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    await broadcastSyncState({ isSyncing: true });

    const items = await getAllQueueItems();
    let lastError = null;
    let sent = false;
    for (const item of items) {
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
          body: JSON.stringify({ ...item.payload, offline: { ownerUserId: item.ownerUserId, organizationId: item.organizationId, facilityId: item.facilityId, queueId: item.id }, observedAt: item.payload.observedAt || item.queuedAt }),
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
