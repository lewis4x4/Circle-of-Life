import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type DeliveryPatch,
  type DeliveryRow,
  type DispatchContext,
  type DueRungRow,
  type EngineEnv,
  type EngineStore,
  type FireResult,
  runEscalationEngine,
} from "./engine.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY = "00000000-0000-0000-0000-000000000301";
const RESIDENT = "20000000-0000-4000-8000-000000000001";
const TASK = "40000000-0000-4000-8000-000000000001";
const DISPATCH_NUDGE = "50000000-0000-4000-8000-000000000001";
const DISPATCH_TIER = "50000000-0000-4000-8000-000000000002";
const USER = "30000000-0000-4000-8000-000000000001";

const SMS_ENV: EngineEnv = {
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  DISPATCH_PUSH_SECRET: "push-secret",
  TWILIO_ACCOUNT_SID: "sid",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_FROM_NUMBER: "+10000000000",
  OBSERVATION_ESCALATION_SMS_ENABLED: "true",
};

function dueRow(rungKey: string, assignedStaffOnly: boolean, channels: string[]): DueRungRow {
  return {
    task_id: TASK,
    organization_id: ORG,
    facility_id: FACILITY,
    resident_id: RESIDENT,
    escalation_version_id: "60000000-0000-4000-8000-000000000001",
    rung_key: rungKey,
    label: rungKey,
    is_terminal: rungKey === "tier_3",
    assigned_staff_only: assignedStaffOnly,
    channels,
    shift_key: "day",
    window_closes_at: "2026-09-16T15:00:00.000Z",
    fire_at: "2026-09-16T15:30:00.000Z",
  };
}

function deliveryRow(overrides: Partial<DeliveryRow>): DeliveryRow {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    organization_id: ORG,
    facility_id: FACILITY,
    dispatch_id: DISPATCH_TIER,
    rung_key: "tier_1",
    target_user_id: USER,
    target_phone: null,
    channel: "in_app",
    is_test: false,
    message_body: null,
    ...overrides,
  };
}

interface Recorder {
  fired: { taskId: string; rungKey: string }[];
  patches: { id: string; patch: DeliveryPatch }[];
  lapseCalls: number;
}

function fakeStore(
  due: DueRungRow[],
  fireResults: Record<string, FireResult>,
  deliveries: DeliveryRow[],
  contexts: Map<string, DispatchContext>,
  recorder: Recorder,
): EngineStore {
  return {
    advanceLapse() {
      recorder.lapseCalls += 1;
      return Promise.resolve(3);
    },
    loadDue() {
      return Promise.resolve(due);
    },
    fireRung(taskId, rungKey) {
      recorder.fired.push({ taskId, rungKey });
      return Promise.resolve(fireResults[rungKey] ?? { fired: false, reason: "rung_not_in_force" });
    },
    loadQueuedDeliveries() {
      return Promise.resolve(deliveries);
    },
    loadDispatchContexts() {
      return Promise.resolve(contexts);
    },
    loadUserPhones() {
      return Promise.resolve(new Map<string, string | null>([[USER, "+15550000000"]]));
    },
    updateDelivery(id, patch) {
      recorder.patches.push({ id, patch });
      return Promise.resolve();
    },
  };
}

/**
 * `typeof fetch` in Deno is a union of three RequestInit shapes and `body` is
 * not on all of them, so the tests read it through one narrowing helper rather
 * than casting at four call sites.
 */
function bodyOf(init: unknown): string {
  const record = init as { body?: unknown } | undefined;
  if (typeof record?.body === "string") return record.body;
  if (record?.body instanceof URLSearchParams) return record.body.toString();
  return "";
}

function newRecorder(): Recorder {
  return { fired: [], patches: [], lapseCalls: 0 };
}

const silentLog = { log() {} };

Deno.test("a nudge is recorded as a reminder and a tier as an escalation", async () => {
  const recorder = newRecorder();
  const store = fakeStore(
    [dueRow("nudge", true, ["push"]), dueRow("tier_1", false, ["in_app", "push"])],
    {
      nudge: { fired: true, rung_key: "nudge", is_escalation: false, deliveries_queued: 1 },
      tier_1: { fired: true, rung_key: "tier_1", is_escalation: true, deliveries_queued: 2 },
    },
    [],
    new Map(),
    recorder,
  );

  const result = await runEscalationEngine({
    store,
    fetchImpl: () => Promise.reject(new Error("no network in this test")),
    env: {},
    log: silentLog,
    organizationId: ORG,
  });

  assertEquals(recorder.lapseCalls, 1);
  assertEquals(result.tasks_lapsed, 3);
  assertEquals(result.rungs_due, 2);
  assertEquals(result.rungs_fired, 2);
  assertEquals(result.escalations_recorded, 1);
  assertEquals(result.reminders_recorded, 1);
});

Deno.test("a re-tick that finds a rung already fired records it and counts no new escalation", async () => {
  const recorder = newRecorder();
  const store = fakeStore(
    [dueRow("tier_1", false, ["in_app"])],
    { tier_1: { fired: false, reason: "already_fired", rung_key: "tier_1" } },
    [],
    new Map(),
    recorder,
  );

  const result = await runEscalationEngine({
    store,
    fetchImpl: () => Promise.reject(new Error("no network in this test")),
    env: {},
    log: silentLog,
    organizationId: ORG,
  });

  assertEquals(result.rungs_fired, 0);
  assertEquals(result.rungs_already_fired, 1);
  assertEquals(result.escalations_recorded, 0);
});

Deno.test("in_app is marked sent without a network call and push goes to dispatch-push", async () => {
  const recorder = newRecorder();
  const calls: { url: string; body: unknown }[] = [];
  const contexts = new Map<string, DispatchContext>([
    [DISPATCH_TIER, { taskId: TASK, label: "First escalation", protocolText: null, isReminder: false, room: "12" }],
  ]);
  const store = fakeStore(
    [],
    {},
    [
      deliveryRow({ id: "in-app-row", channel: "in_app" }),
      deliveryRow({ id: "push-row", channel: "push" }),
    ],
    contexts,
    recorder,
  );

  const result = await runEscalationEngine({
    store,
    fetchImpl: (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(bodyOf(init) || "{}") });
      return Promise.resolve(new Response(JSON.stringify({ sent: 1, failed: 0 }), { status: 200 }));
    },
    env: SMS_ENV,
    log: silentLog,
    organizationId: ORG,
  });

  assertEquals(result.deliveries_processed, 2);
  assertEquals(result.deliveries_sent, 2);
  assertEquals(calls.length, 1);
  assertStringIncludes(calls[0].url, "/functions/v1/dispatch-push");
  const pushBody = calls[0].body as { title: string; body: string };
  assertEquals(pushBody.title, "First escalation");
  assertStringIncludes(pushBody.body, "Room 12");
});

Deno.test("sms is skipped when the channel is not configured and sent when it is", async () => {
  const contexts = new Map<string, DispatchContext>([
    [DISPATCH_TIER, { taskId: TASK, label: "Final escalation", protocolText: "Walk the building.", isReminder: false, room: "12" }],
  ]);

  const offRecorder = newRecorder();
  const off = await runEscalationEngine({
    store: fakeStore([], {}, [deliveryRow({ id: "sms-off", channel: "sms" })], contexts, offRecorder),
    fetchImpl: () => Promise.reject(new Error("no network in this test")),
    env: { SUPABASE_URL: "https://example.invalid" },
    log: silentLog,
    organizationId: ORG,
  });
  assertEquals(off.deliveries_skipped, 1);
  assertEquals(offRecorder.patches[0].patch.skip_reason, "channel_not_enabled");

  const onRecorder = newRecorder();
  const sent: string[] = [];
  const on = await runEscalationEngine({
    store: fakeStore([], {}, [deliveryRow({ id: "sms-on", channel: "sms" })], contexts, onRecorder),
    fetchImpl: (input, init) => {
      sent.push(String(new URLSearchParams(bodyOf(init)).get("Body")));
      return Promise.resolve(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    },
    env: SMS_ENV,
    log: silentLog,
    organizationId: ORG,
  });
  assertEquals(on.deliveries_sent, 1);
  assertStringIncludes(sent[0], "Walk the building.");
  assertEquals(onRecorder.patches[0].patch.provider_message_id, "SM1");
});

Deno.test("a test send is delivered with its stored body, TEST first, and needs no dispatch", async () => {
  const recorder = newRecorder();
  const bodies: string[] = [];
  const store = fakeStore(
    [],
    {},
    [
      deliveryRow({
        id: "test-row",
        channel: "push",
        dispatch_id: null,
        is_test: true,
        rung_key: "tier_2",
        message_body: "TEST only, no action needed. This is a test of the Second escalation step.",
      }),
    ],
    new Map(),
    recorder,
  );

  const result = await runEscalationEngine({
    store,
    fetchImpl: (_input, init) => {
      bodies.push(String((JSON.parse(bodyOf(init) || "{}") as { body: string }).body));
      return Promise.resolve(new Response(JSON.stringify({ sent: 1 }), { status: 200 }));
    },
    env: SMS_ENV,
    log: silentLog,
    organizationId: ORG,
  });

  assertEquals(result.deliveries_sent, 1);
  assert(bodies[0].startsWith("TEST "), `test body must start with TEST, got ${bodies[0]}`);
});

Deno.test("a delivery whose dispatch cannot be loaded is skipped rather than sent blank", async () => {
  const recorder = newRecorder();
  const store = fakeStore([], {}, [deliveryRow({ id: "orphan", channel: "push", dispatch_id: DISPATCH_NUDGE })], new Map(), recorder);

  const result = await runEscalationEngine({
    store,
    fetchImpl: () => Promise.reject(new Error("no network in this test")),
    env: SMS_ENV,
    log: silentLog,
    organizationId: ORG,
  });

  assertEquals(result.deliveries_skipped, 1);
  assertEquals(recorder.patches[0].patch.skip_reason, "dispatch_not_found");
});
