import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type QueueItem = {
  clientEventId: string;
  ownerUserId: string | null;
  payload: Record<string, unknown>;
  queuedAt: string;
  retryCount: number;
  lastError?: string | null;
  terminal?: boolean;
};

async function flush(status: number, ownerUserId: string | null = "operator", body: unknown = { error: "Conflict" }) {
  const items: QueueItem[] = [
    {
      clientEventId: "queued",
      ownerUserId,
      payload: { client_event_id: "queued", facility_id: "facility", kind: "fall", answers: { hurt: "not_hurt" } },
      queuedAt: "2026-09-16T02:06:00Z",
      retryCount: 0,
    },
  ];
  const deleted: string[] = [];
  const puts: QueueItem[] = [];
  const posts: { url: string; init: RequestInit }[] = [];
  const broadcasts: unknown[] = [];
  const context = vm.createContext({
    self: {
      addEventListener() {},
      clients: {
        matchAll: async () => [{ postMessage: (message: unknown) => broadcasts.push(message) }],
      },
    },
    fetch: async (url: string, init: RequestInit) => {
      posts.push({ url, init });
      if (status === 0) throw new TypeError("Failed to fetch");
      return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
    },
  });
  vm.runInContext(fs.readFileSync("public/sw.js", "utf8"), context);
  Object.assign(context, {
    getAllCareEventQueueItems: async () => items,
    putCareEventQueueItem: async (item: QueueItem) => {
      puts.push({ ...item });
    },
    deleteCareEventQueueItem: async (id: string) => {
      deleted.push(id);
    },
  });
  const result = (await vm.runInContext("flushCareEventQueue()", context)) as { sent: unknown[]; lastError: string | null };
  return { deleted, puts, posts, broadcasts, items, result };
}

describe("service worker care event queue", () => {
  it("declares the second database version and cache generation", () => {
    const source = fs.readFileSync("public/sw.js", "utf8");
    expect(source).toContain('const DB_VERSION = 2;');
    expect(source).toContain('const STATIC_CACHE = "haven-static-v5";');
    expect(source).toContain('"haven-static-v4"');
    expect(source).toContain('createObjectStore(CARE_EVENT_STORE_NAME, { keyPath: "clientEventId" })');
    expect(source).toContain('"haven-care-event-sync"');
  });

  it("posts to the submit endpoint with same-origin cookies and removes the item on success", async () => {
    const receipt = { care_event_id: "ce-1", level: 2, incident_number: "HOM-2026-0007", deliveries: [] };
    const run = await flush(200, "operator", receipt);
    expect(run.deleted).toEqual(["queued"]);
    expect(run.posts).toHaveLength(1);
    expect(run.posts[0].url).toBe("/api/care-events/submit");
    expect(run.posts[0].init.credentials).toBe("same-origin");
    expect((run.posts[0].init.headers as Record<string, string>)["x-haven-sync"]).toBe("service-worker");
    expect(JSON.parse(String(run.posts[0].init.body))).toMatchObject({ client_event_id: "queued", captured_offline: true });
    expect(run.result.sent).toEqual([{ clientEventId: "queued", receipt }]);
    const last = run.broadcasts.at(-1) as { type: string; state: { sent: unknown[] } };
    expect(last.type).toBe("HAVEN_CARE_EVENT_QUEUE_STATE");
    expect(last.state.sent).toEqual([{ clientEventId: "queued", receipt }]);
  });

  it("retains the item with lastError and retryCount on a network error", async () => {
    const run = await flush(0);
    expect(run.deleted).toEqual([]);
    expect(run.puts).toHaveLength(1);
    expect(run.puts[0].retryCount).toBe(1);
    // The test's TypeError comes from outside the vm realm, so the worker stringifies it.
    expect(run.puts[0].lastError).toMatch(/Failed to fetch/);
    expect(run.puts[0].terminal).toBeUndefined();
  });

  it("marks 422 terminal so it is not retried automatically", async () => {
    const run = await flush(422, "operator", { error: "care_event: resident not at facility" });
    expect(run.deleted).toEqual([]);
    expect(run.puts[0].terminal).toBe(true);
    expect(run.puts[0].lastError).toBe("care_event: resident not at facility");
    expect(run.result.lastError).toBe("care_event: resident not at facility");
  });

  it("marks 409 terminal and keeps 500 retryable", async () => {
    expect((await flush(409)).puts[0].terminal).toBe(true);
    expect((await flush(500)).puts[0].terminal).toBe(false);
  });

  it("retains an item without an owner and never posts it", async () => {
    const run = await flush(200, null);
    expect(run.posts).toEqual([]);
    expect(run.deleted).toEqual([]);
    expect(run.puts[0].lastError).toMatch(/Original operator is unknown/);
  });
});
