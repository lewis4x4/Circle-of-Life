"use client";

import type { CompletionPayload } from "@/lib/rounding/types";

const FLUSH_COMMAND = "HAVEN_FLUSH_ROUNDING_QUEUE";
const QUEUE_COMMAND = "HAVEN_QUEUE_ROUNDING_COMPLETION";
const STATE_COMMAND = "HAVEN_PING_ROUNDING_SYNC_STATE";
const SYNC_TAG = "haven-rounding-sync";

export type RoundingOfflineQueueItem = {
  id: string;
  taskId: string;
  residentId: string;
  payload: CompletionPayload;
  queuedAt: string;
  retryCount: number;
  lastError: string | null;
};

export type RoundingSyncState = {
  pendingCount: number;
  queuedTaskIds: string[];
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  online: boolean;
  supported: boolean;
};

type SyncCapableRegistration = ServiceWorkerRegistration & {
  sync?: {
    register: (tag: string) => Promise<void>;
  };
};

type SyncStatePayload = Omit<RoundingSyncState, "online" | "supported">;

function defaultState(): RoundingSyncState {
  return {
    pendingCount: 0,
    queuedTaskIds: [],
    isSyncing: false,
    lastSyncedAt: null,
    lastError: null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    supported: typeof window !== "undefined" && "serviceWorker" in navigator,
  };
}

export function supportsRoundingOfflineSync() {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

async function getServiceWorkerEndpoint(): Promise<{ worker: ServiceWorker; registration: SyncCapableRegistration }> {
  const existing = (await navigator.serviceWorker.getRegistration()) as SyncCapableRegistration | undefined;
  if (!existing) {
    throw new Error("Service worker is not registered.");
  }

  const registration = existing;
  const worker =
    navigator.serviceWorker.controller ??
    registration.active ??
    registration.waiting ??
    registration.installing;

  if (!worker) {
    throw new Error("Service worker is not active.");
  }

  return { worker, registration };
}

async function sendServiceWorkerCommand<TResponse>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<TResponse> {
  if (!supportsRoundingOfflineSync()) {
    throw new Error("Service worker is not supported in this browser.");
  }

  const { worker } = await getServiceWorkerEndpoint();

  return await new Promise<TResponse>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      reject(new Error("Service worker command timed out."));
    }, 8000);

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

async function registerBackgroundSync(registration: SyncCapableRegistration) {
  if (!registration.sync?.register) return;
  try {
    await registration.sync.register(SYNC_TAG);
  } catch {
    // Background sync is optional. Online flush remains available.
  }
}

function isLikelyNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|network|load failed|abort/i.test(error.message);
}

export async function queueRoundingCompletion(taskId: string, residentId: string, payload: CompletionPayload) {
  if (!supportsRoundingOfflineSync()) {
    throw new Error("Offline sync is not supported in this browser.");
  }

  const item: RoundingOfflineQueueItem = {
    id: crypto.randomUUID(),
    taskId,
    residentId,
    payload,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
  };

  const { registration } = await getServiceWorkerEndpoint();
  await sendServiceWorkerCommand<{ ok: true; state: SyncStatePayload }>(QUEUE_COMMAND, { item });
  await registerBackgroundSync(registration);

  if (navigator.onLine) {
    try {
      await flushQueuedRounds();
    } catch {
      // Leave the item in queue for later retry.
    }
  }

  return item;
}

export async function requestRoundingSyncState() {
  if (!supportsRoundingOfflineSync()) return defaultState();

  try {
    const response = await sendServiceWorkerCommand<{ ok: true; state: SyncStatePayload }>(STATE_COMMAND);
    return {
      ...defaultState(),
      ...response.state,
      online: navigator.onLine,
      supported: true,
    } satisfies RoundingSyncState;
  } catch {
    return defaultState();
  }
}

export async function flushQueuedRounds() {
  if (!supportsRoundingOfflineSync()) return defaultState();

  const { registration } = await getServiceWorkerEndpoint();
  await registerBackgroundSync(registration);

  const response = await sendServiceWorkerCommand<{ ok: true; state: SyncStatePayload }>(FLUSH_COMMAND);
  return {
    ...defaultState(),
    ...response.state,
    online: navigator.onLine,
    supported: true,
  } satisfies RoundingSyncState;
}

export function subscribeToRoundingSyncState(callback: (state: RoundingSyncState) => void) {
  if (!supportsRoundingOfflineSync()) {
    callback(defaultState());
    return () => {};
  }

  const handleMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } & Partial<RoundingSyncState>;
    if (data?.type !== "HAVEN_ROUNDING_SYNC_STATE") return;
    callback({
      ...defaultState(),
      ...data,
      online: navigator.onLine,
      supported: true,
    });
  };

  navigator.serviceWorker.addEventListener("message", handleMessage);
  return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
}

export function shouldQueueRoundingRequest(error: unknown) {
  return !navigator.onLine || isLikelyNetworkError(error);
}
