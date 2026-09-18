import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type EngineStore,
  type EvaluationResult,
  runWatchlistEngine,
} from "./engine.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY_A = "00000000-0000-0000-0002-000000000001";
const FACILITY_B = "00000000-0000-0000-0002-000000000002";
const AT = new Date("2026-09-17T12:00:00.000Z");

function noopLog() {
  const entries: Array<Record<string, unknown>> = [];
  return { entries, log: (entry: Record<string, unknown>) => entries.push(entry) };
}

function store(
  facilityIds: string[],
  answer: (facilityId: string) => EvaluationResult | Promise<EvaluationResult>,
): EngineStore & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    loadFacilityIds: () => Promise.resolve(facilityIds),
    evaluateFacility: async (facilityId) => {
      asked.push(facilityId);
      return await answer(facilityId);
    },
  };
}

Deno.test("evaluates every building in the organization and sums what it did", async () => {
  const log = noopLog();
  const s = store([FACILITY_A, FACILITY_B], (id) => ({
    ok: true,
    facility_id: id,
    opened: id === FACILITY_A ? 3 : 1,
    refreshed: 2,
    cleared: 1,
    notified: id === FACILITY_A ? 4 : 0,
  }));

  const tick = await runWatchlistEngine({
    store: s,
    log,
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(s.asked, [FACILITY_A, FACILITY_B]);
  assertEquals(tick.facilities_attempted, 2);
  assertEquals(tick.facilities_succeeded, 2);
  assertEquals(tick.facilities_failed, 0);
  assertEquals(tick.opened, 4);
  assertEquals(tick.refreshed, 4);
  assertEquals(tick.cleared, 2);
  assertEquals(tick.notified, 4);
});

Deno.test("a single facility request asks about that building only", async () => {
  const log = noopLog();
  const s = store([FACILITY_B], () => ({ ok: true, opened: 0, refreshed: 0, cleared: 0, notified: 0 }));

  const tick = await runWatchlistEngine({
    store: s,
    log,
    organizationId: ORG,
    facilityId: FACILITY_B,
    now: () => AT,
  });

  assertEquals(s.asked, [FACILITY_B]);
  assertEquals(tick.facilities_attempted, 1);
});

Deno.test("a building that declines to evaluate is a failure, never a quiet success", async () => {
  const log = noopLog();
  const s = store([FACILITY_A, FACILITY_B], (id) =>
    id === FACILITY_A
      ? { ok: true, opened: 1, refreshed: 0, cleared: 0, notified: 0 }
      : { ok: false, reason: "facility_not_found" });

  const tick = await runWatchlistEngine({
    store: s,
    log,
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(tick.facilities_failed, 1);
  assertEquals(tick.failed_facility_ids, [FACILITY_B]);
  assertEquals(tick.facilities_succeeded, 1);
  assertEquals(tick.facilities.find((f) => f.facility_id === FACILITY_B)?.reason, "facility_not_found");
  assertEquals(log.entries.at(-1)?.outcome, "error");
});

Deno.test("one building raising does not stop the rest of the round", async () => {
  const log = noopLog();
  const s = store([FACILITY_A, FACILITY_B], (id) => {
    if (id === FACILITY_A) throw new Error("evaluate watchlist signals (57014)");
    return { ok: true, opened: 2, refreshed: 0, cleared: 0, notified: 1 };
  });

  const tick = await runWatchlistEngine({
    store: s,
    log,
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(s.asked, [FACILITY_A, FACILITY_B]);
  assertEquals(tick.facilities_failed, 1);
  assertEquals(tick.failed_facility_ids, [FACILITY_A]);
  assertEquals(tick.opened, 2);
  assertEquals(tick.notified, 1);
});

Deno.test("the tick log carries counts and facility ids and no resident detail", async () => {
  const log = noopLog();
  const s = store([FACILITY_A], () => ({ ok: true, opened: 1, refreshed: 0, cleared: 0, notified: 2 }));

  await runWatchlistEngine({ store: s, log, organizationId: ORG, facilityId: null, now: () => AT });

  const entry = log.entries.at(-1) ?? {};
  const keys = Object.keys(entry).sort();
  assertEquals(keys, [
    "cleared",
    "event",
    "facilities_attempted",
    "facilities_failed",
    "notified",
    "opened",
    "outcome",
  ]);
  assert(!("resident_id" in entry));
});

Deno.test("an organization with no buildings answers cleanly rather than failing", async () => {
  const log = noopLog();
  const s = store([], () => ({ ok: true }));

  const tick = await runWatchlistEngine({ store: s, log, organizationId: ORG, facilityId: null, now: () => AT });

  assertEquals(tick.facilities_attempted, 0);
  assertEquals(tick.facilities_failed, 0);
  assertEquals(tick.opened, 0);
});
