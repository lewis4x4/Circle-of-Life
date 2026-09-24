import { afterEach, describe, expect, it, vi } from "vitest";

import { FLOOR_DEVICE_HEADER, FLOOR_LOCK_ENDPOINT } from "./contract";
import { clearBrowserSessionCookies, floorLockHref, sendFloorLock } from "./lock-client";
import { clearFloorUnlockId, setFloorUnlockId } from "./session-context";

const UNLOCK_A = "11111111-1111-4111-8111-111111111111";
const UNLOCK_B = "22222222-2222-4222-8222-222222222222";

function onlineTarget() {
  const listeners = new Set<() => void>();
  return {
    target: {
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    } as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
    fire: () => [...listeners].forEach((fn) => fn()),
    count: () => listeners.size,
  };
}

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as { unlock_id: string; reason: string };

afterEach(() => clearFloorUnlockId());

describe("sendFloorLock", () => {
  it("sends the lock before returning to the event loop when the page holds the token, so it survives the page closing", () => {
    setFloorUnlockId(UNLOCK_A);
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    void sendFloorLock("sleep", fetchImpl as unknown as typeof fetch, "device-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FLOOR_LOCK_ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)[FLOOR_DEVICE_HEADER]).toBe("device-token");
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ unlock_id: UNLOCK_A, reason: "sleep" });
  });

  it("locks the unlock that was current when it was asked, never the next person's", async () => {
    setFloorUnlockId(UNLOCK_A);
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    // No token passed: the device is read from IndexedDB first. The next person unlocks meanwhile.
    const pending = sendFloorLock("switch", fetchImpl as unknown as typeof fetch, null);
    setFloorUnlockId(UNLOCK_B);
    await pending;
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({ unlock_id: UNLOCK_A, reason: "switch" });
  });

  it("offline, sends the same lock again once the network is back", async () => {
    setFloorUnlockId(UNLOCK_A);
    const online = onlineTarget();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await sendFloorLock("idle", fetchImpl as unknown as typeof fetch, "device-token", { target: online.target });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(online.count()).toBe(1);
    clearFloorUnlockId();
    online.fire();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchImpl.mock.calls[1])).toEqual({ unlock_id: UNLOCK_A, reason: "idle" });
    expect(online.count()).toBe(0);
  });
});

describe("clearBrowserSessionCookies", () => {
  it("expires the Supabase session cookies in the page, without the network, and leaves others", () => {
    let jar = "sb-ref-auth-token.0=abc; sb-ref-auth-token.1=def; theme=dark; sb-ref-auth-token-code-verifier=x";
    const writes: string[] = [];
    const doc = {
      get cookie() {
        return jar;
      },
      set cookie(value: string) {
        writes.push(value);
        const name = value.split("=")[0];
        jar = jar
          .split("; ")
          .filter((entry) => !entry.startsWith(`${name}=`))
          .join("; ");
      },
    };
    expect(clearBrowserSessionCookies(doc)).toEqual(["sb-ref-auth-token.0", "sb-ref-auth-token.1", "sb-ref-auth-token-code-verifier"]);
    expect(writes.every((value) => value.includes("Max-Age=0") && value.includes("path=/"))).toBe(true);
    expect(jar).toBe("theme=dark");
  });
});

describe("floorLockHref", () => {
  it("carries why the tablet locked to the lock screen", () => {
    expect(floorLockHref("clocked_out")).toBe("/floor/lock?reason=clocked_out");
    expect(floorLockHref(null)).toBe("/floor/lock");
  });
});
