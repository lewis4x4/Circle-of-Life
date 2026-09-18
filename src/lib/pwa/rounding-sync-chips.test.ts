import fs from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

/**
 * A caregiver records a check on a phone with no signal, and the observation
 * waits in the outbox until the building's wifi comes back. The chips are what
 * compose the stored sentence, so an outbox replay that drops them would post a
 * check that looks complete, reads as blank, and takes the standard window with
 * it. The service worker forwards the queued payload verbatim; this asserts it
 * stays verbatim now that the payload carries chips.
 */
async function replayQueuedChipObservation() {
  const chipSelections = {
    meal_intake: ["refused_meal"],
    mood_state: ["agitated"],
    med_response: ["refused_meds"],
  };
  const items = [
    {
      id: "queue",
      taskId: "task",
      ownerUserId: "operator",
      organizationId: "org",
      facilityId: "facility",
      payload: {
        requestId: "offline-request",
        observedAt: "2026-09-16T10:04:00Z",
        quickStatus: "agitated",
        residentLocation: "dining_room",
        residentState: "needs_assistance",
        chipSelections,
      },
      queuedAt: "2026-09-16T10:05:00Z",
      retryCount: 0,
    },
  ];
  const bodies: string[] = [];
  const deleted: string[] = [];
  const context = vm.createContext({
    self: { addEventListener() {}, clients: { matchAll: async () => [] } },
    fetch: async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return { ok: true, status: 200 };
    },
  });
  vm.runInContext(fs.readFileSync("public/sw.js", "utf8"), context);
  Object.assign(context, {
    getAllQueueItems: async () => items,
    putQueueItem: async () => {},
    deleteQueueItem: async (id: string) => {
      deleted.push(id);
    },
  });
  await vm.runInContext("flushQueue()", context);
  return { bodies, deleted, chipSelections };
}

it("replays a queued observation with its chips intact", async () => {
  const { bodies, deleted, chipSelections } = await replayQueuedChipObservation();

  expect(deleted).toEqual(["queue"]);
  expect(bodies).toHaveLength(1);

  const replayed = JSON.parse(bodies[0]);
  expect(replayed.chipSelections).toEqual(chipSelections);
  expect(replayed).toMatchObject({
    requestId: "offline-request",
    quickStatus: "agitated",
    residentLocation: "dining_room",
    residentState: "needs_assistance",
  });
});

it("does not invent chips for a queued observation that carried none", async () => {
  const items = [
    {
      id: "queue",
      taskId: "task",
      ownerUserId: "operator",
      organizationId: "org",
      facilityId: "facility",
      payload: { requestId: "legacy-request", quickStatus: "calm" },
      queuedAt: "2026-09-16T10:05:00Z",
      retryCount: 0,
    },
  ];
  const bodies: string[] = [];
  const context = vm.createContext({
    self: { addEventListener() {}, clients: { matchAll: async () => [] } },
    fetch: async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return { ok: true, status: 200 };
    },
  });
  vm.runInContext(fs.readFileSync("public/sw.js", "utf8"), context);
  Object.assign(context, {
    getAllQueueItems: async () => items,
    putQueueItem: async () => {},
    deleteQueueItem: async () => {},
  });
  await vm.runInContext("flushQueue()", context);

  expect(JSON.parse(bodies[0]).chipSelections).toBeUndefined();
});
