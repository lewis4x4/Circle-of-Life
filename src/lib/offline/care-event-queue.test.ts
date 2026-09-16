import { describe, expect, it, vi } from "vitest";

import {
  createMemoryQueueStore,
  listQueuedCareEvents,
  queueCareEvent,
  queueSizeForOwner,
  removeQueuedCareEvent,
  replayQueuedCareEvents,
  type CareEventQueueItem,
} from "./care-event-queue";

const RECEIPT = {
  care_event_id: "33333333-3333-4333-8333-333333333333",
  level: 2,
  incident_number: "HOM-2026-0007",
  incident_id: null,
  deliveries: [],
  next_check_at: null,
  replayed: true,
};

function item(overrides: Partial<CareEventQueueItem> = {}): CareEventQueueItem {
  return {
    clientEventId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "operator",
    organizationId: "org",
    facilityId: "facility",
    payload: {
      client_event_id: "22222222-2222-4222-8222-222222222222",
      facility_id: "facility",
      resident_id: "11111111-1111-4111-8111-111111111111",
      kind: "fall",
      answers: { hurt: "not_hurt", head: "no", witnessed: "yes", going_out: "no", worried: false },
      note: null,
      occurred_at: "2026-09-16T02:06:00.000Z",
      location_code: null,
      captured_offline: true,
    },
    level: 2,
    queuedAt: "2026-09-16T02:06:00.000Z",
    retryCount: 0,
    lastError: null,
    terminal: false,
    ...overrides,
  };
}

function responseWith(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("replayQueuedCareEvents", () => {
  it("posts the payload with captured_offline and removes the item on 2xx", async () => {
    const store = createMemoryQueueStore([item()]);
    const fetchImpl = vi.fn(async () => responseWith(200, RECEIPT));
    const result = await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/care-events/submit");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toMatchObject({ client_event_id: item().clientEventId, captured_offline: true });
    expect(result.sent).toEqual([{ clientEventId: item().clientEventId, receipt: { ...RECEIPT, level: 2 } }]);
    expect(await store.all()).toEqual([]);
  });

  it("keeps the item with lastError and retryCount on a network error", async () => {
    const store = createMemoryQueueStore([item()]);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    expect(result.sent).toEqual([]);
    expect(result.failed).toEqual([{ clientEventId: item().clientEventId, error: "Failed to fetch", terminal: false }]);
    const kept = await store.get(item().clientEventId);
    expect(kept?.retryCount).toBe(1);
    expect(kept?.lastError).toBe("Failed to fetch");
    expect(kept?.terminal).toBe(false);
  });

  it("marks 422 and 409 terminal and never retries them", async () => {
    const store = createMemoryQueueStore([item()]);
    const fetchImpl = vi.fn(async () => responseWith(422, { error: "care_event: resident not at facility" }));
    const first = await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    expect(first.failed[0]).toEqual({ clientEventId: item().clientEventId, error: "care_event: resident not at facility", terminal: true });
    expect((await store.get(item().clientEventId))?.terminal).toBe(true);
    const second = await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.sent).toEqual([]);
    expect(await queueSizeForOwner("operator", store)).toBe(0);
    expect(await listQueuedCareEvents("operator", store)).toHaveLength(1);
  });

  it("posts the queue owner and keeps a 403 (wrong operator) retryable, not terminal", async () => {
    const store = createMemoryQueueStore([item()]);
    const fetchImpl = vi.fn(async () =>
      responseWith(403, { error: "This event belongs to a different operator. Sign in as its original reporter to send it." }),
    );
    const result = await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ queue_owner_user_id: "operator" });
    expect(result.failed).toEqual([
      { clientEventId: item().clientEventId, error: "This event belongs to a different operator. Sign in as its original reporter to send it.", terminal: false },
    ]);
    const kept = await store.get(item().clientEventId);
    expect(kept?.terminal).toBe(false);
    expect(kept?.retryCount).toBe(1);
    // Still pending for the owner: a later replay tries again.
    expect(await queueSizeForOwner("operator", store)).toBe(1);
    await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never replays another owner's items", async () => {
    const store = createMemoryQueueStore([item({ ownerUserId: "someone-else" })]);
    const fetchImpl = vi.fn(async () => responseWith(200, RECEIPT));
    const result = await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.sent).toEqual([]);
    expect(await store.all()).toHaveLength(1);
    expect(await replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: null })).toEqual({ sent: [], failed: [] });
  });

  it("does not double-post when two replays overlap", async () => {
    const store = createMemoryQueueStore([item()]);
    let release: (() => void) | null = null;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(responseWith(200, RECEIPT));
        }),
    );
    const first = replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    await Promise.resolve();
    await Promise.resolve();
    const second = replayQueuedCareEvents({ fetchImpl: fetchImpl as unknown as typeof fetch, store, ownerUserId: "operator" });
    await Promise.resolve();
    await Promise.resolve();
    expect(release).not.toBeNull();
    release!();
    const [a, b] = await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
  });
});

describe("in-page fallback", () => {
  it("queues into the injected store and replays on demand", async () => {
    const store = createMemoryQueueStore();
    const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      await queueCareEvent(item(), { store });
      expect(await queueSizeForOwner("operator", store)).toBe(1);
      await removeQueuedCareEvent(item().clientEventId, store);
      expect(await queueSizeForOwner("operator", store)).toBe(0);
    } finally {
      if (originalOnLine) Object.defineProperty(Navigator.prototype, "onLine", originalOnLine);
      else delete (navigator as unknown as { onLine?: boolean }).onLine;
    }
  });
});
