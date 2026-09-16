import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CareEventRow,
  type DeliveryPatch,
  type DeliveryRow,
  type DispatcherEnv,
  type DispatcherStore,
  type ResidentContext,
  runDispatcher,
} from "./handler.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY = "00000000-0000-0000-0000-000000000301";
const EVENT_OPEN = "10000000-0000-4000-8000-000000000001";
const EVENT_ACKED = "10000000-0000-4000-8000-000000000002";
const RESIDENT = "20000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000001";

const TWILIO_ENV: DispatcherEnv = {
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  DISPATCH_PUSH_SECRET: "dispatch-test-secret",
  TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32),
  TWILIO_AUTH_TOKEN: "twilio-test-token",
  TWILIO_FROM_NUMBER: "+15555550100",
  CARE_EVENT_SMS_ENABLED: "true",
};

const PUSH_ONLY_ENV: DispatcherEnv = {
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  DISPATCH_PUSH_SECRET: "dispatch-test-secret",
};

function delivery(overrides: Partial<DeliveryRow> & Pick<DeliveryRow, "id" | "channel">): DeliveryRow {
  return {
    organization_id: ORG,
    facility_id: FACILITY,
    care_event_id: EVENT_OPEN,
    escalation_step: 0,
    target_role: "facility_admin",
    target_user_id: USER,
    target_phone: null,
    send_after: "2026-09-15T14:00:00.000Z",
    ...overrides,
  };
}

const EVENTS: CareEventRow[] = [
  { id: EVENT_OPEN, resident_id: RESIDENT, kind: "fall", final_level: "level_3", status: "open", deleted_at: null },
  { id: EVENT_ACKED, resident_id: RESIDENT, kind: "wandering", final_level: "level_4", status: "acknowledged", deleted_at: null },
];

function fakeStore(deliveries: DeliveryRow[], options: { phone?: string | null } = {}) {
  const patches = new Map<string, DeliveryPatch>();
  const calls: string[] = [];
  const store: DispatcherStore = {
    loadQueuedDeliveries: (_nowIso, limit) => {
      calls.push("loadQueuedDeliveries");
      return Promise.resolve(deliveries.slice(0, limit));
    },
    loadCareEvents: (ids) => {
      calls.push("loadCareEvents");
      return Promise.resolve(EVENTS.filter((e) => ids.includes(e.id)));
    },
    loadResidentContexts: (ids) => {
      calls.push("loadResidentContexts");
      const map = new Map<string, ResidentContext>();
      if (ids.includes(RESIDENT)) map.set(RESIDENT, { firstName: "Patricia", lastName: "Brownell", room: "12B" });
      return Promise.resolve(map);
    },
    loadUserPhones: (ids) => {
      calls.push("loadUserPhones");
      const map = new Map<string, string | null>();
      for (const id of ids) map.set(id, options.phone === undefined ? null : options.phone);
      return Promise.resolve(map);
    },
    updateDelivery: (id, patch) => {
      patches.set(id, patch);
      return Promise.resolve();
    },
  };
  return { store, patches, calls };
}

type FetchCall = { url: string; init: RequestInit };

function recordingFetch(respond: (url: string, init: RequestInit) => Response) {
  const fetchCalls: FetchCall[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return Promise.resolve(respond(url, init ?? {}));
  }) as typeof fetch;
  return { fetchImpl, fetchCalls };
}

const mustNotFetch = (() => {
  throw new Error("fetch must not be called");
}) as typeof fetch;

const silent = { log: () => {} };

Deno.test("sms row is skipped with channel_not_enabled when Twilio env is absent, without fetching", async () => {
  const { store, patches, calls } = fakeStore([delivery({ id: "d-sms", channel: "sms" }), delivery({ id: "d-voice", channel: "voice" })]);
  const result = await runDispatcher({ store, fetchImpl: mustNotFetch, env: PUSH_ONLY_ENV, log: silent });

  assertEquals(result, { processed: 2, sent: 0, skipped: 2, failed: 0 });
  assertEquals(patches.get("d-sms"), { status: "skipped", skip_reason: "channel_not_enabled", error_message: null });
  assertEquals(patches.get("d-voice"), { status: "skipped", skip_reason: "channel_not_enabled", error_message: null });
  assert(!calls.includes("loadUserPhones"), "phones must not be looked up when Twilio is disabled");
});

Deno.test("acknowledged parent event marks every row skipped/acknowledged without calling fetch", async () => {
  const { store, patches } = fakeStore([
    delivery({ id: "d-in-app", channel: "in_app", care_event_id: EVENT_ACKED }),
    delivery({ id: "d-push", channel: "push", care_event_id: EVENT_ACKED }),
    delivery({ id: "d-sms", channel: "sms", care_event_id: EVENT_ACKED, target_phone: "+15555550199" }),
  ]);
  const result = await runDispatcher({ store, fetchImpl: mustNotFetch, env: TWILIO_ENV, log: silent });

  assertEquals(result, { processed: 3, sent: 0, skipped: 3, failed: 0 });
  for (const id of ["d-in-app", "d-push", "d-sms"]) {
    assertEquals(patches.get(id), { status: "skipped", skip_reason: "acknowledged", error_message: null });
  }
});

Deno.test("in_app marks sent with sent_at and no provider id", async () => {
  const now = new Date("2026-09-15T14:05:00.000Z");
  const { store, patches } = fakeStore([delivery({ id: "d-in-app", channel: "in_app" })]);
  const result = await runDispatcher({ store, fetchImpl: mustNotFetch, env: PUSH_ONLY_ENV, log: silent, now });

  assertEquals(result, { processed: 1, sent: 1, skipped: 0, failed: 0 });
  const patch = patches.get("d-in-app");
  assertEquals(patch?.status, "sent");
  assertEquals(patch?.provider_message_id, null);
  assertEquals(patch?.skip_reason, null);
  assert(typeof patch?.sent_at === "string" && patch.sent_at.length > 0);
});

Deno.test("push posts to dispatch-push with the secret and a PHI-bounded body; classifies sent, no_subscription, failed", async () => {
  const { store, patches } = fakeStore([
    delivery({ id: "d-push-sent", channel: "push", target_user_id: "30000000-0000-4000-8000-000000000011" }),
    delivery({ id: "d-push-none", channel: "push", target_user_id: "30000000-0000-4000-8000-000000000012" }),
    delivery({ id: "d-push-fail", channel: "push", target_user_id: "30000000-0000-4000-8000-000000000013" }),
    delivery({ id: "d-push-nouser", channel: "push", target_user_id: null }),
  ]);
  const { fetchImpl, fetchCalls } = recordingFetch((_url, init) => {
    const body = JSON.parse(String(init.body)) as { user_id: string };
    if (body.user_id.endsWith("11")) return new Response(JSON.stringify({ sent: 1, failed: 0, results: [] }), { status: 200 });
    if (body.user_id.endsWith("12")) return new Response(JSON.stringify({ sent: 0, failed: 0, results: [] }), { status: 200 });
    return new Response(JSON.stringify({ error: "VAPID keys must be set" }), { status: 503 });
  });
  const result = await runDispatcher({ store, fetchImpl, env: PUSH_ONLY_ENV, log: silent });

  assertEquals(result, { processed: 4, sent: 1, skipped: 2, failed: 1 });
  assertEquals(fetchCalls.length, 3, "no fetch for the row with no target user");
  for (const call of fetchCalls) {
    assertEquals(call.url, "https://example.invalid/functions/v1/dispatch-push");
    const headers = call.init.headers as Record<string, string>;
    assertEquals(headers["x-dispatch-secret"], "dispatch-test-secret");
    assertEquals(headers.Authorization, "Bearer service-role-test-key");
    assertEquals(headers["Content-Type"], "application/json");
    const body = JSON.parse(String(call.init.body)) as { title: string; body: string; url: string };
    assertEquals(body.title, "Urgent: Fall");
    assertEquals(body.body, `P. Brownell, room 12B. Fall. Urgent. /admin/care-events/${EVENT_OPEN}`);
    assertEquals(body.url, `/admin/care-events/${EVENT_OPEN}`);
    assert(!body.body.includes("Patricia"));
  }
  assertEquals(patches.get("d-push-sent")?.status, "sent");
  assertEquals(patches.get("d-push-none"), { status: "skipped", skip_reason: "no_subscription", error_message: null });
  assertEquals(patches.get("d-push-fail"), { status: "failed", error_message: "dispatch-push 503: VAPID keys must be set", skip_reason: null });
  assertEquals(patches.get("d-push-nouser"), { status: "skipped", skip_reason: "no_target_user", error_message: null });
});

Deno.test("push is skipped with channel_not_enabled when DISPATCH_PUSH_SECRET is missing", async () => {
  const { store, patches } = fakeStore([delivery({ id: "d-push", channel: "push" })]);
  const env: DispatcherEnv = { ...PUSH_ONLY_ENV, DISPATCH_PUSH_SECRET: undefined };
  const result = await runDispatcher({ store, fetchImpl: mustNotFetch, env, log: silent });
  assertEquals(result, { processed: 1, sent: 0, skipped: 1, failed: 0 });
  assertEquals(patches.get("d-push"), { status: "skipped", skip_reason: "channel_not_enabled", error_message: null });
});

Deno.test("sms uses target_phone or the profile phone, posts a form to Twilio, and records the sid", async () => {
  const { store, patches, calls } = fakeStore(
    [
      delivery({ id: "d-sms-direct", channel: "sms", target_phone: "+15555550111" }),
      delivery({ id: "d-sms-profile", channel: "sms", target_phone: null }),
      delivery({ id: "d-voice", channel: "voice", target_phone: "+15555550111" }),
    ],
    { phone: "+15555550122" },
  );
  const { fetchImpl, fetchCalls } = recordingFetch((url) =>
    new Response(JSON.stringify({ sid: url.endsWith("Calls.json") ? "CA" + "2".repeat(32) : "SM" + "1".repeat(32) }), { status: 201 })
  );
  const result = await runDispatcher({ store, fetchImpl, env: TWILIO_ENV, log: silent });

  assertEquals(result, { processed: 3, sent: 3, skipped: 0, failed: 0 });
  assert(calls.includes("loadUserPhones"));
  assertEquals(fetchCalls.length, 3);

  const bySid = new Map(fetchCalls.map((c) => [String((c.init.body as URLSearchParams).get("To")) + c.url.slice(-10), c]));
  const direct = fetchCalls.find((c) => c.url.endsWith("Messages.json") && (c.init.body as URLSearchParams).get("To") === "+15555550111");
  const profile = fetchCalls.find((c) => c.url.endsWith("Messages.json") && (c.init.body as URLSearchParams).get("To") === "+15555550122");
  const voice = fetchCalls.find((c) => c.url.endsWith("Calls.json"));
  assert(direct && profile && voice, `expected three distinct Twilio calls, got ${[...bySid.keys()].join(",")}`);

  for (const call of [direct, profile, voice]) {
    assertEquals(call.url.startsWith(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ENV.TWILIO_ACCOUNT_SID}/`), true);
    const headers = call.init.headers as Record<string, string>;
    assertEquals(headers.Authorization, `Basic ${btoa(`${TWILIO_ENV.TWILIO_ACCOUNT_SID}:${TWILIO_ENV.TWILIO_AUTH_TOKEN}`)}`);
    assertEquals((call.init.body as URLSearchParams).get("From"), "+15555550100");
  }
  const smsBody = (direct.init.body as URLSearchParams).get("Body");
  assertEquals(smsBody, `P. Brownell, room 12B. Fall. Urgent. /admin/care-events/${EVENT_OPEN}`);
  const twiml = (voice.init.body as URLSearchParams).get("Twiml");
  assertEquals(twiml, `<Response><Say>P. Brownell, room 12B. Fall. Urgent. /admin/care-events/${EVENT_OPEN}</Say></Response>`);

  assertEquals(patches.get("d-sms-direct")?.status, "sent");
  assertEquals(patches.get("d-sms-direct")?.provider_message_id, "SM" + "1".repeat(32));
  assertEquals(patches.get("d-sms-profile")?.provider_message_id, "SM" + "1".repeat(32));
  assertEquals(patches.get("d-voice")?.provider_message_id, "CA" + "2".repeat(32));
});

Deno.test("sms with no phone anywhere is skipped with no_phone; Twilio error message is recorded on failure", async () => {
  const { store, patches } = fakeStore(
    [
      delivery({ id: "d-sms-nophone", channel: "sms", target_phone: null }),
      delivery({ id: "d-sms-bad", channel: "sms", target_phone: "+15555550111" }),
    ],
    { phone: null },
  );
  const { fetchImpl, fetchCalls } = recordingFetch(() =>
    new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }), { status: 400 })
  );
  const result = await runDispatcher({ store, fetchImpl, env: TWILIO_ENV, log: silent });

  assertEquals(result, { processed: 2, sent: 0, skipped: 1, failed: 1 });
  assertEquals(fetchCalls.length, 1);
  assertEquals(patches.get("d-sms-nophone"), { status: "skipped", skip_reason: "no_phone", error_message: null });
  assertEquals(patches.get("d-sms-bad"), { status: "failed", error_message: "twilio sms 400: Invalid 'To' Phone Number", skip_reason: null });
});

Deno.test("a delivery whose parent event is missing is skipped with event_not_found", async () => {
  const { store, patches } = fakeStore([delivery({ id: "d-orphan", channel: "push", care_event_id: "10000000-0000-4000-8000-0000000000ff" })]);
  const result = await runDispatcher({ store, fetchImpl: mustNotFetch, env: PUSH_ONLY_ENV, log: silent });
  assertEquals(result, { processed: 1, sent: 0, skipped: 1, failed: 0 });
  assertEquals(patches.get("d-orphan")?.skip_reason, "event_not_found");
});

Deno.test("a fetch that throws becomes a failed row and does not abort the drain", async () => {
  const { store, patches } = fakeStore([
    delivery({ id: "d-push-throw", channel: "push" }),
    delivery({ id: "d-in-app", channel: "in_app" }),
  ]);
  const fetchImpl = (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;
  const logged: Record<string, unknown>[] = [];
  const result = await runDispatcher({ store, fetchImpl, env: PUSH_ONLY_ENV, log: { log: (e) => logged.push(e) } });

  assertEquals(result, { processed: 2, sent: 1, skipped: 0, failed: 1 });
  assertEquals(patches.get("d-push-throw"), { status: "failed", error_message: "dispatch-push request failed: TypeError", skip_reason: null });
  const complete = logged.find((e) => e.event === "complete");
  assertEquals(complete?.processed, 2);
  assertEquals(complete?.failed, 1);
  for (const entry of logged) {
    const text = JSON.stringify(entry);
    assert(!text.includes("Brownell") && !text.includes("Patricia") && !text.includes("12B"), `log leaked resident data: ${text}`);
  }
});

Deno.test("empty queue completes with zero counts and touches nothing else", async () => {
  const { store, calls } = fakeStore([]);
  const result = await runDispatcher({ store, fetchImpl: mustNotFetch, env: TWILIO_ENV, log: silent });
  assertEquals(result, { processed: 0, sent: 0, skipped: 0, failed: 0 });
  assertEquals(calls, ["loadQueuedDeliveries"]);
});
