import { describe, expect, it, vi } from "vitest";

import { FLOOR_DEVICE_HEADER, FLOOR_LOCK_ENDPOINT } from "./contract";
import { floorLockHref, sendFloorLock } from "./lock-client";
import { clearFloorUnlockId, setFloorUnlockId } from "./session-context";

describe("sendFloorLock", () => {
  it("sends the lock before returning to the event loop when the page holds the token, so it survives the page closing", () => {
    setFloorUnlockId("11111111-1111-4111-8111-111111111111");
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    void sendFloorLock("sleep", fetchImpl as unknown as typeof fetch, "device-token");
    // No await: the request has already left.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FLOOR_LOCK_ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)[FLOOR_DEVICE_HEADER]).toBe("device-token");
    expect(JSON.parse(String(init.body))).toEqual({ unlock_id: "11111111-1111-4111-8111-111111111111", reason: "sleep" });
    clearFloorUnlockId();
  });

  it("resolves even when the tablet is offline", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(sendFloorLock("idle", fetchImpl as unknown as typeof fetch, "device-token")).resolves.toBeUndefined();
  });
});

describe("floorLockHref", () => {
  it("carries why the tablet locked to the lock screen", () => {
    expect(floorLockHref("clocked_out")).toBe("/floor/lock?reason=clocked_out");
    expect(floorLockHref(null)).toBe("/floor/lock");
  });
});
