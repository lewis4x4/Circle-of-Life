import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ActivationResult,
  type EngineStore,
  runCadenceVersionActivator,
} from "./engine.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY_A = "00000000-0000-0000-0003-000000000001";
const FACILITY_B = "00000000-0000-0000-0003-000000000002";
const AT = new Date("2026-09-17T12:00:00.000Z");

function noopLog() {
  const entries: Array<Record<string, unknown>> = [];
  return { entries, log: (entry: Record<string, unknown>) => entries.push(entry) };
}

function store(
  result: ActivationResult,
  regeneration: boolean | null = true,
): EngineStore & { asked: string[]; regenerated: string[] } {
  const asked: string[] = [];
  const regenerated: string[] = [];
  return {
    asked,
    regenerated,
    activateDueVersions: (organizationId, facilityId, atIso) => {
      asked.push(`${organizationId}:${facilityId ?? "all"}:${atIso}`);
      return Promise.resolve(result);
    },
    requestRegeneration: (_organizationId, facilityId) => {
      if (regeneration !== null) regenerated.push(facilityId);
      return Promise.resolve(regeneration);
    },
  };
}

Deno.test("passes the organization, the facility scope and the instant straight through", async () => {
  const s = store({ ok: true, versions_due: 0, versions_activated: 0, versions_failed: 0, versions: [] });
  await runCadenceVersionActivator({
    store: s,
    log: noopLog(),
    organizationId: ORG,
    facilityId: FACILITY_A,
    now: () => AT,
  });
  assertEquals(s.asked, [`${ORG}:${FACILITY_A}:${AT.toISOString()}`]);
});

Deno.test("a cadence activation that cancelled pending tasks asks for one regeneration per building", async () => {
  const s = store({
    ok: true,
    versions_due: 3,
    versions_activated: 3,
    versions_failed: 0,
    versions: [
      { ok: true, kind: "cadence", facility_id: FACILITY_A, version_id: "v1", pending_tasks_cancelled: 4 },
      { ok: true, kind: "escalation", facility_id: FACILITY_A, version_id: "v2", pending_tasks_cancelled: 0 },
      { ok: true, kind: "cadence", facility_id: FACILITY_B, version_id: "v3", pending_tasks_cancelled: 2 },
    ],
  });
  const tick = await runCadenceVersionActivator({
    store: s,
    log: noopLog(),
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(s.regenerated, [FACILITY_A, FACILITY_B]);
  assertEquals(tick.facilities_regenerated, [FACILITY_A, FACILITY_B]);
  assertEquals(tick.pending_tasks_cancelled, 6);
  assertEquals(tick.versions_activated, 3);
  assert(tick.regeneration_requested);
});

Deno.test("an escalation activation never asks for a regeneration", async () => {
  // An escalation change moves who hears about a missed check. It generates
  // nothing, so there is no hole in the board to fill.
  const s = store({
    ok: true,
    versions_due: 1,
    versions_activated: 1,
    versions_failed: 0,
    versions: [
      { ok: true, kind: "escalation", facility_id: FACILITY_A, version_id: "v1", pending_tasks_cancelled: 0 },
    ],
  });
  const tick = await runCadenceVersionActivator({
    store: s,
    log: noopLog(),
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(s.regenerated, []);
  assertEquals(tick.regeneration_skipped_reason, "nothing_to_regenerate");
  assert(!tick.regeneration_requested);
});

Deno.test("a version that refused is reported by id and makes the tick fail", async () => {
  const s = store({
    ok: false,
    versions_due: 2,
    versions_activated: 1,
    versions_failed: 1,
    versions: [
      { ok: true, kind: "cadence", facility_id: FACILITY_A, version_id: "v1", pending_tasks_cancelled: 1 },
      { ok: false, kind: "cadence", facility_id: FACILITY_B, version_id: "v2", reason: "activating backwards" },
    ],
  });
  const tick = await runCadenceVersionActivator({
    store: s,
    log: noopLog(),
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(tick.versions_failed, 1);
  assertEquals(tick.failed_version_ids, ["v2"]);
  // The building that did activate still gets its board rebuilt. One refusal
  // does not strand the other four.
  assertEquals(tick.facilities_regenerated, [FACILITY_A]);
});

Deno.test("no generator endpoint is reported as not requested, never as done", async () => {
  const s = store(
    {
      ok: true,
      versions_due: 1,
      versions_activated: 1,
      versions_failed: 0,
      versions: [
        { ok: true, kind: "cadence", facility_id: FACILITY_A, version_id: "v1", pending_tasks_cancelled: 3 },
      ],
    },
    null,
  );
  const tick = await runCadenceVersionActivator({
    store: s,
    log: noopLog(),
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(tick.facilities_regenerated, []);
  assertEquals(tick.regeneration_skipped_reason, "no_generator_endpoint_configured");
  assert(!tick.regeneration_requested);
});

Deno.test("the tick log carries counts and no resident detail", async () => {
  const log = noopLog();
  await runCadenceVersionActivator({
    store: store({
      ok: true,
      versions_due: 1,
      versions_activated: 1,
      versions_failed: 0,
      versions: [
        { ok: true, kind: "cadence", facility_id: FACILITY_A, version_id: "v1", pending_tasks_cancelled: 1 },
      ],
    }),
    log,
    organizationId: ORG,
    facilityId: null,
    now: () => AT,
  });

  assertEquals(log.entries.length, 1);
  const entry = log.entries[0];
  assertEquals(entry.event, "tick_complete");
  assertEquals(entry.outcome, "success");
  assertEquals(entry.versions_activated, 1);
  assertEquals(entry.pending_tasks_cancelled, 1);
  // Counts only. No resident id, no name, no room, no message body.
  assert(!Object.keys(entry).some((key) => /resident|name|room|body|phone/i.test(key)));
});

Deno.test("a new cadence with no canceled tasks still generates its new windows", async () => {
  const s = store({ ok: true, versions_activated: 1, versions: [
    { ok: true, kind: "cadence", facility_id: FACILITY_A, pending_tasks_cancelled: 0 },
  ] });
  const tick = await runCadenceVersionActivator({store:s,log:noopLog(),organizationId:ORG,facilityId:null});
  assertEquals(tick.facilities_regenerated, [FACILITY_A]);
});

Deno.test("failed regeneration is reported separately from successful activation", async () => {
  const s = store({ ok:true, versions_activated:1, versions:[
    { ok:true,kind:"cadence",facility_id:FACILITY_A,pending_tasks_cancelled:2 },
  ] }, false);
  const log = noopLog();
  const tick = await runCadenceVersionActivator({store:s,log,organizationId:ORG,facilityId:null});
  assertEquals(tick.regeneration_failed_facility_ids,[FACILITY_A]);
  assertEquals(log.entries[0].outcome,"error");
});
