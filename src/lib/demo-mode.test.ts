import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_MODE_STORAGE_KEY, isDemoMode } from "./demo-mode";

const ORIGINAL_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE;
const storage = new Map<string, string>();

function installLocalStorageMock() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      clear: () => storage.clear(),
    },
  });
}

function resetDemoModeState() {
  if (ORIGINAL_DEMO_MODE === undefined) {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  } else {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO_MODE;
  }
  storage.clear();
}

describe("isDemoMode", () => {
  beforeEach(installLocalStorageMock);
  afterEach(resetDemoModeState);

  it("does not allow stale browser storage to enable demo mode without the env flag", () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, "true");

    expect(isDemoMode()).toBe(false);
  });

  it("allows browser storage to disable an env-enabled demo session", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, "false");

    expect(isDemoMode()).toBe(false);
  });

  it("enables demo mode when explicitly configured by environment", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";

    expect(isDemoMode()).toBe(true);
  });

  it("returns false when window is unavailable (SSR) even if env is true", async () => {
    const prevWindow = globalThis.window;
    const prevEnv = process.env.NEXT_PUBLIC_DEMO_MODE;

    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    // @ts-expect-error — simulate SSR
    delete globalThis.window;

    vi.resetModules();
    const { isDemoMode: isDemoModeFresh } = await import("./demo-mode");
    expect(isDemoModeFresh()).toBe(false);

    globalThis.window = prevWindow;
    process.env.NEXT_PUBLIC_DEMO_MODE = prevEnv;
    vi.resetModules();
    await import("./demo-mode");
  });
});
