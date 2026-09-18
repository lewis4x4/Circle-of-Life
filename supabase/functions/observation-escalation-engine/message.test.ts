import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEscalationMessage,
  classifyPushResponse,
  classifyTwilioResponse,
  NO_ROOM_TAG,
  roomTag,
  smsChannelEnabled,
  taskPath,
  taskUrl,
} from "./message.ts";

const TASK = "40000000-0000-4000-8000-000000000001";

Deno.test("roomTag renders a room and says so when there is none", () => {
  assertEquals(roomTag("12"), "Room 12");
  assertEquals(roomTag("  12b "), "Room 12b");
  assertEquals(roomTag(null), NO_ROOM_TAG);
  assertEquals(roomTag("   "), NO_ROOM_TAG);
});

Deno.test("taskUrl prefixes the base and taskPath stays a bare path", () => {
  assertEquals(taskPath(TASK), `/admin/rounding?task=${TASK}`);
  assertEquals(taskUrl(TASK, ""), `/admin/rounding?task=${TASK}`);
  assertEquals(taskUrl(TASK, "https://example.invalid/"), `https://example.invalid/admin/rounding?task=${TASK}`);
});

Deno.test("an escalation body carries the room, the rung label as the title, and the link", () => {
  const message = buildEscalationMessage({
    label: "First escalation",
    protocolText: null,
    isReminder: false,
    room: "12",
    taskId: TASK,
    appBaseUrl: "",
  });
  assertEquals(message.title, "First escalation");
  assertStringIncludes(message.body, "Room 12");
  assertStringIncludes(message.body, "closed without a check");
  assertStringIncludes(message.body, `/admin/rounding?task=${TASK}`);
});

Deno.test("a reminder says the window is about to close, not that it closed", () => {
  const message = buildEscalationMessage({
    label: "Staff nudge",
    protocolText: null,
    isReminder: true,
    room: "12",
    taskId: TASK,
    appBaseUrl: "",
  });
  assertEquals(message.title, "Staff nudge");
  assertStringIncludes(message.body, "about to close");
  assert(!message.body.includes("closed without a check"));
});

Deno.test("protocol text is appended only when the rung carries one", () => {
  const without = buildEscalationMessage({
    label: "Second escalation",
    protocolText: "   ",
    isReminder: false,
    room: "12",
    taskId: TASK,
    appBaseUrl: "",
  });
  assert(!without.body.includes("  "), "an empty protocol must not leave a double space");

  const withProtocol = buildEscalationMessage({
    label: "Final escalation",
    protocolText: "Walk the building room by room.",
    isReminder: false,
    room: "12",
    taskId: TASK,
    appBaseUrl: "",
  });
  assertStringIncludes(withProtocol.body, "Walk the building room by room.");
});

Deno.test("no resident name can reach a body because the input has no field for one", () => {
  // The extra properties below are deliberately not on EscalationMessageInput.
  // The cast proves that even a caller that passes them cannot get them out.
  const message = buildEscalationMessage({
    label: "First escalation",
    protocolText: null,
    isReminder: false,
    room: "12",
    taskId: TASK,
    appBaseUrl: "",
    // deno-lint-ignore no-explicit-any
    ...({ firstName: "Notreal", lastName: "Synthetic", note: "clinical note" } as any),
  });
  assert(!message.body.includes("Notreal"));
  assert(!message.body.includes("Synthetic"));
  assert(!message.body.includes("clinical note"));
});

Deno.test("sms needs all three Twilio values and the explicit enable flag", () => {
  const full = {
    TWILIO_ACCOUNT_SID: "sid",
    TWILIO_AUTH_TOKEN: "token",
    TWILIO_FROM_NUMBER: "+10000000000",
    OBSERVATION_ESCALATION_SMS_ENABLED: "true",
  };
  assert(smsChannelEnabled(full));
  assert(!smsChannelEnabled({ ...full, OBSERVATION_ESCALATION_SMS_ENABLED: "yes" }));
  assert(!smsChannelEnabled({ ...full, TWILIO_FROM_NUMBER: "  " }));
  assert(!smsChannelEnabled({}));
});

Deno.test("a push that reached no subscription is a skip, not a failure", () => {
  assertEquals(classifyPushResponse(200, { sent: 1, failed: 0 }).status, "sent");
  const none = classifyPushResponse(200, { sent: 0, failed: 0 });
  assertEquals(none.status, "skipped");
  assertEquals(none.skipReason, "no_subscription");
  const failed = classifyPushResponse(503, { error: "VAPID missing" });
  assertEquals(failed.status, "failed");
  assertStringIncludes(failed.error ?? "", "dispatch-push 503");
});

Deno.test("twilio success carries the sid and failure carries the short reason", () => {
  const sent = classifyTwilioResponse(201, { sid: "SM1" });
  assertEquals(sent.status, "sent");
  assertEquals(sent.providerMessageId, "SM1");
  const failed = classifyTwilioResponse(400, { message: "unverified number" });
  assertEquals(failed.status, "failed");
  assertStringIncludes(failed.error ?? "", "twilio sms 400");
});
