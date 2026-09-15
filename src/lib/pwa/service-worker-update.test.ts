import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateServiceWorkerUpdate,
  bindServiceWorkerUpdateListeners,
  HAVEN_SKIP_WAITING_MESSAGE,
  isServiceWorkerWaitingForRefresh,
  watchInstallingWorkerForRefresh,
} from "./service-worker-update";

describe("isServiceWorkerWaitingForRefresh", () => {
  it("is true when registration.waiting is set", () => {
    expect(
      isServiceWorkerWaitingForRefresh({ waiting: {} } as ServiceWorkerRegistration),
    ).toBe(true);
  });

  it("is false when no waiting worker", () => {
    expect(isServiceWorkerWaitingForRefresh({ waiting: null } as ServiceWorkerRegistration)).toBe(
      false,
    );
  });
});

describe("watchInstallingWorkerForRefresh", () => {
  it("calls onNeedRefresh when already installed with an active controller", () => {
    const onNeedRefresh = vi.fn();
    const worker = { state: "installed", addEventListener: vi.fn() } as unknown as ServiceWorker;
    watchInstallingWorkerForRefresh(worker, true, onNeedRefresh);
    expect(onNeedRefresh).toHaveBeenCalledOnce();
  });

  it("waits for installed state when a controller exists", () => {
    const listeners: Record<string, () => void> = {};
    const worker = {
      state: "installing",
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
    } as unknown as ServiceWorker;
    const onNeedRefresh = vi.fn();
    watchInstallingWorkerForRefresh(worker, true, onNeedRefresh);
    expect(onNeedRefresh).not.toHaveBeenCalled();
    worker.state = "installed";
    listeners.statechange?.();
    expect(onNeedRefresh).toHaveBeenCalledOnce();
  });
});

describe("bindServiceWorkerUpdateListeners", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: {} } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies immediately when a waiting worker exists", () => {
    const onNeedRefresh = vi.fn();
    const registration = {
      waiting: {},
      installing: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ServiceWorkerRegistration;

    bindServiceWorkerUpdateListeners(registration, onNeedRefresh, { updateIntervalMs: 60_000 });
    expect(onNeedRefresh).toHaveBeenCalledOnce();
  });

  it("notifies on updatefound when installing worker becomes installed", () => {
    const onNeedRefresh = vi.fn();
    const updateFoundHandlers: Array<() => void> = [];
    const workerListeners: Record<string, () => void> = {};
    const installing = {
      state: "installing",
      addEventListener: (type: string, fn: () => void) => {
        workerListeners[type] = fn;
      },
    } as unknown as ServiceWorker;

    const registration = {
      waiting: null,
      installing,
      addEventListener: (type: string, fn: () => void) => {
        if (type === "updatefound") updateFoundHandlers.push(fn);
      },
      removeEventListener: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ServiceWorkerRegistration;

    bindServiceWorkerUpdateListeners(registration, onNeedRefresh, { updateIntervalMs: 60_000 });
    updateFoundHandlers.forEach((handler) => handler());
    (installing as { state: string }).state = "installed";
    workerListeners.statechange?.();
    expect(onNeedRefresh).toHaveBeenCalledOnce();
  });

  it("periodically calls registration.update", () => {
    vi.useFakeTimers();
    const onNeedRefresh = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const registration = {
      waiting: null,
      installing: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      update,
    } as unknown as ServiceWorkerRegistration;

    bindServiceWorkerUpdateListeners(registration, onNeedRefresh, { updateIntervalMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    expect(update).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("activateServiceWorkerUpdate", () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    vi.stubGlobal("location", { reload });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        addEventListener: vi.fn(),
      },
    });
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      location: { reload },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reloads immediately when there is no waiting worker", () => {
    activateServiceWorkerUpdate({ waiting: null } as ServiceWorkerRegistration);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("posts skip-waiting to the waiting worker and reloads on controller change", () => {
    const postMessage = vi.fn();
    const waiting = { postMessage } as unknown as ServiceWorker;
    let controllerHandler: (() => void) | undefined;
    vi.stubGlobal("navigator", {
      serviceWorker: {
        addEventListener: (type: string, fn: () => void) => {
          if (type === "controllerchange") controllerHandler = fn;
        },
      },
    });

    activateServiceWorkerUpdate({ waiting } as ServiceWorkerRegistration);
    expect(postMessage).toHaveBeenCalledWith(HAVEN_SKIP_WAITING_MESSAGE);
    controllerHandler?.();
    expect(reload).toHaveBeenCalled();
  });
});
