import { describe, expect, it, vi } from "vitest";

import { KIOSK_DEVICE_HEADER } from "./kiosk-contract";
import { createMemoryKioskStore, pinMemory, replayKioskQueue, type QueuedPunch } from "./kiosk-store";

const DEVICE = { token: "tok", facilityId: "f1", facilityName: "Synthetic facility", enrolledAt: "2026-09-16T10:00:00.000Z" };

function item(id: string, minute: number, punchType: QueuedPunch["punchType"] = "in"): QueuedPunch {
  return {
    clientPunchId: id,
    identifier: "A-100",
    punchType,
    deviceTime: `2026-09-16T10:${String(minute).padStart(2, "0")}:00.000Z`,
    queuedAt: `2026-09-16T10:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

const NOW = () => new Date("2026-09-16T12:00:00.000Z");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("replayKioskQueue", () => {
  it("replays in capture order, sends the in-memory PIN, and removes sent items", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("c", 3, "out"), item("a", 1), item("b", 2, "meal_start")] });
    pinMemory.set("a", "123456");
    pinMemory.set("b", "123456");
    pinMemory.set("c", "123456");
    const fetchImpl = vi.fn(async () => json(200, { punch_id: "p" }));
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result).toEqual({ sent: 3, rejected: 0, dropped: 0, stopped: false });
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies.map((b) => b.client_punch_id)).toEqual(["a", "b", "c"]);
    expect(bodies.every((b) => b.captured_offline === true && b.pin === "123456")).toBe(true);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)[KIOSK_DEVICE_HEADER]).toBe("tok");
    expect(await store.listQueue()).toEqual([]);
    expect(pinMemory.has("a")).toBe(false);
  });

  it("stops at a network failure so later punches never land first", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("a", 1), item("b", 2, "out")] });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.stopped).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await store.listQueue()).map((q) => q.clientPunchId)).toEqual(["a", "b"]);
  });

  it("drops a 4xx rejection silently (the server keeps it for the manager) and continues", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("a", 1), item("b", 2)] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(422, { error: "rejected_offline" }))
      .mockResolvedValueOnce(json(200, { punch_id: "p" }));
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result).toEqual({ sent: 1, rejected: 1, dropped: 0, stopped: false });
    expect(await store.listQueue()).toEqual([]);
  });

  it("keeps a punch the server never recorded: a 429 throttle stops the replay (COL-352 review S2)", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("a", 1), item("b", 2, "out")] });
    const fetchImpl = vi.fn(async () => json(429, { error: "device_throttled" }));
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result).toEqual({ sent: 0, rejected: 0, dropped: 0, stopped: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await store.listQueue()).map((q) => q.clientPunchId)).toEqual(["a", "b"]);
  });

  it("keeps a punch when the device was revoked (401), rather than dropping it silently", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("a", 1)] });
    const fetchImpl = vi.fn(async () => json(401, { error: "device_unknown" }));
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.stopped).toBe(true);
    expect(await store.listQueue()).toHaveLength(1);
  });

  it("drops only a malformed item (400) so it cannot block the queue behind it", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("a", 1), item("b", 2, "out")] });
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(400, { error: "invalid_input" })).mockResolvedValueOnce(json(200, { punch_id: "p" }));
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result).toEqual({ sent: 1, rejected: 0, dropped: 1, stopped: false });
    expect(await store.listQueue()).toEqual([]);
  });

  it("sends an empty PIN when the page memory lost it, so the server records pin_unavailable", async () => {
    const store = createMemoryKioskStore({ device: DEVICE, queue: [item("lost", 1)] });
    pinMemory.delete("lost");
    const fetchImpl = vi.fn(async () => json(422, { error: "rejected_offline" }));
    await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.pin).toBe("");
  });

  it("drops punches older than 24 hours without sending them", async () => {
    const stale: QueuedPunch = { ...item("old", 1), queuedAt: "2026-09-14T10:00:00.000Z" };
    const store = createMemoryKioskStore({ device: DEVICE, queue: [stale] });
    const fetchImpl = vi.fn();
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.dropped).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing without an enrolled device", async () => {
    const store = createMemoryKioskStore({ device: null, queue: [item("a", 1)] });
    const fetchImpl = vi.fn();
    const result = await replayKioskQueue({ store, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });
    expect(result.sent).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
