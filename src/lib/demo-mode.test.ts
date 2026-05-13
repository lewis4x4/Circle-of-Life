import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_MODE_STORAGE_KEY, isDemoMode, isDemoModeEnabledByEnv } from "./demo-mode";

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

  it("never enables legacy demo mode from browser storage", () => {
    window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, "true");

    expect(isDemoMode()).toBe(false);
  });

  it("never enables legacy demo mode from environment flags", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";

    expect(isDemoModeEnabledByEnv()).toBe(false);
    expect(isDemoMode()).toBe(false);
  });

  it("returns false when window is unavailable", async () => {
    const prevWindow = globalThis.window;

    // @ts-expect-error — simulate SSR
    delete globalThis.window;

    vi.resetModules();
    const { isDemoMode: isDemoModeFresh } = await import("./demo-mode");
    expect(isDemoModeFresh()).toBe(false);

    globalThis.window = prevWindow;
    vi.resetModules();
    await import("./demo-mode");
  });
});
