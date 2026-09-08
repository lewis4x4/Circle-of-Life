import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

async function flush(status: number, ownerUserId: string | null = "operator") {
  const items = [{ id: "queued", taskId: "task", ownerUserId, payload: { quickStatus: "distressed" }, queuedAt: "2026-09-06T10:00:00Z", retryCount: 0 }];
  const deleted: string[] = [];
  const context = vm.createContext({
    self: { addEventListener() {}, clients: { matchAll: async () => [] } },
    fetch: async () => ({ ok: status === 200, status, json: async () => ({ error: "Conflict" }) }),
  });
  vm.runInContext(fs.readFileSync("public/sw.js", "utf8"), context);
  Object.assign(context, { getAllQueueItems: async () => items, putQueueItem: async () => {}, deleteQueueItem: async (id: string) => { deleted.push(id); } });
  await vm.runInContext("flushQueue()", context);
  return { deleted, items };
}
describe("offline observation preservation", () => {
  it("retains conflicting distress observations", async () => {
    expect((await flush(409)).deleted).toEqual([]);
  });
  it("does not replay legacy observations with unknown authors", async () => {
    expect((await flush(200, null)).deleted).toEqual([]);
  });
  it("removes only acknowledged successful observations", async () => {
    expect((await flush(200)).deleted).toEqual(["queued"]);
  });
});

it("replays the same request after response loss and removes only the acknowledged retry", async () => {
  const items = [{ id: "queue", taskId: "task", ownerUserId: "operator", organizationId: "org", facilityId: "facility", payload: { requestId: "original-request", observedAt: "2026-09-07T10:00:00Z", quickStatus: "awake" }, queuedAt: "2026-09-07T10:01:00Z", retryCount: 0 }];
  const bodies: string[] = [];
  const deleted: string[] = [];
  const context = vm.createContext({
    self: { addEventListener() {}, clients: { matchAll: async () => [] } },
    fetch: async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      if (bodies.length === 1) throw new Error("response lost after commit");
      return { ok: true, status: 200 };
    },
  });
  vm.runInContext(fs.readFileSync("public/sw.js", "utf8"), context);
  Object.assign(context, { getAllQueueItems: async () => items, putQueueItem: async () => {}, deleteQueueItem: async (id: string) => { deleted.push(id); } });
  await vm.runInContext("flushQueue()", context);
  expect(deleted).toEqual([]);
  await vm.runInContext("flushQueue()", context);
  expect(deleted).toEqual(["queue"]);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[1])).toMatchObject({ requestId: "original-request", observedAt: "2026-09-07T10:00:00Z", offline: { ownerUserId: "operator", organizationId: "org", facilityId: "facility", queueId: "queue" } });
});
