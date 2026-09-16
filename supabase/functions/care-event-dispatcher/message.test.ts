import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCareEventMessage,
  careEventUrl,
  classifyPushResponse,
  classifyTwilioResponse,
  levelWord,
  residentTag,
  tileWord,
  twilioChannelEnabled,
  voiceTwiml,
} from "./message.ts";

const EVENT_ID = "0f2b7c1e-6d2a-4f5e-9b8c-7a6d5e4f3c2b";

// Decoy clinical strings. None of these may ever appear in a title, body, or url.
const DECOY_SENTENCE = "Found on the floor in the resident room at 10:05 PM. Not witnessed.";
const DECOY_DIAGNOSIS = "Type 2 diabetes mellitus";
const DECOY_DOB = "1941-03-17";

Deno.test("body carries only first initial, last name, room, tile word, level word, and the link", () => {
  const message = buildCareEventMessage({
    firstName: "Patricia",
    lastName: "Brownell",
    room: "12B",
    kind: "fall",
    level: "level_3",
    careEventId: EVENT_ID,
    appBaseUrl: "https://haven.example.invalid",
    // Extra properties the builder must ignore. Cast because the input type has no such fields.
    ...({ sentence: DECOY_SENTENCE, primary_diagnosis: DECOY_DIAGNOSIS, date_of_birth: DECOY_DOB } as Record<string, string>),
  });

  assertEquals(message.title, "Urgent: Fall");
  assertEquals(message.body, `P. Brownell, room 12B. Fall. Urgent. https://haven.example.invalid/admin/care-events/${EVENT_ID}`);
  assertEquals(message.url, `https://haven.example.invalid/admin/care-events/${EVENT_ID}`);

  for (const text of [message.title, message.body, message.url]) {
    for (const decoy of [DECOY_SENTENCE, DECOY_DIAGNOSIS, DECOY_DOB, "Patricia", "10:05"]) {
      assert(!text.includes(decoy), `${JSON.stringify(text)} must not contain ${JSON.stringify(decoy)}`);
    }
  }
});

Deno.test("empty app base url yields a bare path and no invented host", () => {
  const message = buildCareEventMessage({
    firstName: null,
    lastName: null,
    room: null,
    kind: "environment",
    level: 1,
    careEventId: EVENT_ID,
    appBaseUrl: "",
  });
  assertEquals(message.url, `/admin/care-events/${EVENT_ID}`);
  assertEquals(message.body, `No resident. Building or other. Note. /admin/care-events/${EVENT_ID}`);
  assertEquals(careEventUrl(EVENT_ID, "https://haven.example.invalid///"), `https://haven.example.invalid/admin/care-events/${EVENT_ID}`);
  assertEquals(careEventUrl(EVENT_ID, undefined), `/admin/care-events/${EVENT_ID}`);
});

Deno.test("level word mapping accepts level_n, n, and numbers; anything else is No level posted", () => {
  const expected: Record<string, string> = { 1: "Note", 2: "Heads-up", 3: "Urgent", 4: "Emergency" };
  for (const n of [1, 2, 3, 4]) {
    assertEquals(levelWord(n), expected[n]);
    assertEquals(levelWord(String(n)), expected[n]);
    assertEquals(levelWord(`level_${n}`), expected[n]);
    assertEquals(levelWord(`LEVEL_${n}`), expected[n]);
  }
  for (const bad of [0, 5, "level_5", "", "high", null, undefined]) {
    assertEquals(levelWord(bad), "No level posted");
  }
});

Deno.test("tile word mapping covers all eight kinds and falls back to Event", () => {
  const expected: Record<string, string> = {
    fall: "Fall",
    injury_found: "Hurt",
    condition_change: "Sick or not themselves",
    behavior: "Upset or behavior",
    wandering: "Wandering or left",
    medication: "Medicine",
    family_complaint: "Family or complaint",
    environment: "Building or other",
  };
  assertEquals(Object.keys(expected).length, 8);
  for (const [kind, word] of Object.entries(expected)) assertEquals(tileWord(kind), word);
  assertEquals(tileWord("incident"), "Event");
  assertEquals(tileWord(""), "Event");
  assertEquals(tileWord(null), "Event");
});

Deno.test("residentTag with and without names", () => {
  assertEquals(residentTag("Patricia", "Brownell"), "P. Brownell");
  assertEquals(residentTag("  patricia ", " Brownell "), "p. Brownell");
  assertEquals(residentTag(null, "Brownell"), "Brownell");
  assertEquals(residentTag("Patricia", null), "P.");
  assertEquals(residentTag(null, null), "No resident");
  assertEquals(residentTag("", "   "), "No resident");
});

Deno.test("twilioChannelEnabled requires all three Twilio values and CARE_EVENT_SMS_ENABLED=true", () => {
  const full = {
    TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32),
    TWILIO_AUTH_TOKEN: "test-token",
    TWILIO_FROM_NUMBER: "+15555550100",
    CARE_EVENT_SMS_ENABLED: "true",
  };
  assertEquals(twilioChannelEnabled(full), true);
  for (const key of Object.keys(full)) {
    const missing: Record<string, string | undefined> = { ...full };
    delete missing[key];
    assertEquals(twilioChannelEnabled(missing), false, `missing ${key} must disable`);
    const blank: Record<string, string | undefined> = { ...full, [key]: "  " };
    assertEquals(twilioChannelEnabled(blank), false, `blank ${key} must disable`);
  }
  assertEquals(twilioChannelEnabled({ ...full, CARE_EVENT_SMS_ENABLED: "false" }), false);
  assertEquals(twilioChannelEnabled({ ...full, CARE_EVENT_SMS_ENABLED: "TRUE" }), false);
  assertEquals(twilioChannelEnabled({ ...full, CARE_EVENT_SMS_ENABLED: "1" }), false);
  assertEquals(twilioChannelEnabled({}), false);
});

Deno.test("classifyPushResponse: 200 sent 1, 200 sent 0, 503, 500", () => {
  assertEquals(classifyPushResponse(200, { sent: 1, failed: 0, results: [] }), { status: "sent" });
  assertEquals(classifyPushResponse(200, { sent: 0, failed: 0, results: [] }), { status: "skipped", skipReason: "no_subscription" });
  assertEquals(classifyPushResponse(200, {}), { status: "skipped", skipReason: "no_subscription" });
  assertEquals(
    classifyPushResponse(503, { error: "VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY must be set as Edge Function secrets" }),
    { status: "failed", error: "dispatch-push 503: VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY must be set as Edge Function secrets" },
  );
  assertEquals(classifyPushResponse(500, { error: "Could not load subscriptions" }), { status: "failed", error: "dispatch-push 500: Could not load subscriptions" });
  assertEquals(classifyPushResponse(500, "not json"), { status: "failed", error: "dispatch-push 500" });
  assertEquals(classifyPushResponse(401, { error: "Unauthorized" }), { status: "failed", error: "dispatch-push 401: Unauthorized" });
});

Deno.test("classifyTwilioResponse reads sid on success and message on failure", () => {
  assertEquals(classifyTwilioResponse(201, { sid: "SM" + "1".repeat(32) }, "sms"), { status: "sent", providerMessageId: "SM" + "1".repeat(32) });
  assertEquals(classifyTwilioResponse(201, { sid: "CA" + "2".repeat(32) }, "voice"), { status: "sent", providerMessageId: "CA" + "2".repeat(32) });
  assertEquals(classifyTwilioResponse(400, { code: 21211, message: "Invalid 'To' Phone Number" }, "sms"), {
    status: "failed",
    error: "twilio sms 400: Invalid 'To' Phone Number",
  });
  assertEquals(classifyTwilioResponse(401, {}, "voice"), { status: "failed", error: "twilio voice 401" });
});

Deno.test("voice TwiML escapes the body", () => {
  const twiml = voiceTwiml(`P. O'Brien, room 4 & 5. <Fall>. Urgent.`);
  assertEquals(twiml, "<Response><Say>P. O&apos;Brien, room 4 &amp; 5. &lt;Fall&gt;. Urgent.</Say></Response>");
  assertStringIncludes(twiml, "<Say>");
});
