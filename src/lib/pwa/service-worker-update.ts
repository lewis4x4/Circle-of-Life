/** Post to a waiting worker so it can call skipWaiting (see public/sw.js). */
export const HAVEN_SKIP_WAITING_MESSAGE = { type: "HAVEN_SKIP_WAITING" } as const;

export const SERVICE_WORKER_SCRIPT_URL = "/sw.js";

export const SERVICE_WORKER_REGISTER_OPTIONS: RegistrationOptions = {
  scope: "/",
  updateViaCache: "none",
};

/** How often to poll for a new build while the tab stays open. */
export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * True when a newer worker is installed but the page is still on the previous build.
 */
export function isServiceWorkerWaitingForRefresh(
  registration: ServiceWorkerRegistration,
): boolean {
  return Boolean(registration.waiting);
}

/**
 * When an installing worker reaches `installed` and a controller already exists,
 * the tab is still running the previous build.
 */
export function watchInstallingWorkerForRefresh(
  worker: ServiceWorker,
  hasActiveController: boolean,
  onNeedRefresh: () => void,
): void {
  if (worker.state === "installed" && hasActiveController) {
    onNeedRefresh();
    return;
  }

  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && hasActiveController) {
      onNeedRefresh();
    }
  });
}

/**
 * Subscribe to SW update signals and periodically call `registration.update()`.
 * Returns a cleanup function.
 */
export function bindServiceWorkerUpdateListeners(
  registration: ServiceWorkerRegistration,
  onNeedRefresh: () => void,
  options?: {
    updateIntervalMs?: number;
    onPeriodicUpdate?: (registration: ServiceWorkerRegistration) => void;
  },
): () => void {
  const hasController = () => Boolean(navigator.serviceWorker.controller);

  if (isServiceWorkerWaitingForRefresh(registration)) {
    onNeedRefresh();
  }

  const onUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) return;
    watchInstallingWorkerForRefresh(installing, hasController(), onNeedRefresh);
  };

  registration.addEventListener("updatefound", onUpdateFound);

  const intervalMs = options?.updateIntervalMs ?? SERVICE_WORKER_UPDATE_INTERVAL_MS;
  const intervalId = window.setInterval(() => {
    options?.onPeriodicUpdate?.(registration);
    void registration.update().catch(() => undefined);
  }, intervalMs);

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void registration.update().catch(() => undefined);
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    registration.removeEventListener("updatefound", onUpdateFound);
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/**
 * Activate a waiting worker (if any) and reload once the new controller takes over.
 */
export function activateServiceWorkerUpdate(
  registration: ServiceWorkerRegistration | null | undefined,
): void {
  if (typeof window === "undefined") return;

  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }

  let reloaded = false;
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, { once: true });
  waiting.postMessage(HAVEN_SKIP_WAITING_MESSAGE);

  window.setTimeout(reloadOnce, 3_000);
}
