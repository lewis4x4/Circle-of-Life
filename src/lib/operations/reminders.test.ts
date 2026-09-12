import { describe, expect, it } from "vitest";
import { reminderCommandSchema, reminderLabel, reminderSchema } from "./reminders";
const id = "11111111-1111-4111-8111-111111111111";
const reminder = { id, issue_id: null, source_label: "Check equipment", state: "active", phase: "overdue", problem: null, revision: id, generation: 1, acknowledged_at: null, snoozed_until: null, can_respond: true, suppressed: false, channel: "in_app", delivery_status: "queued", replayed: false };
describe("approved reminder contract", () => {
  it("rejects injected recipient, channel, delivery status or completion", () => {
    for (const extra of [{ recipient: id }, { channel: "sms" }, { delivery_status: "sent" }, { completed: true }]) expect(reminderCommandSchema.safeParse({ command: "refresh", ...extra }).success).toBe(false);
  });
  it("needs revision and durable request identity for responses", () => {
    expect(reminderCommandSchema.safeParse({ command: "acknowledge" }).success).toBe(false);
    expect(reminderCommandSchema.safeParse({ command: "snooze", expected_revision: id, request_key: "retry-request", until: "2026-10-01T12:00:00-04:00", issue_id: id }).success).toBe(true);
  });
  it("does not accept external delivery claims", () => {
    expect(reminderSchema.safeParse({ ...reminder, channel: "sms" }).success).toBe(false);
    expect(reminderSchema.safeParse({ ...reminder, delivery_status: "failed" }).success).toBe(false);
  });
  it("keeps configuration, acknowledgement, source resolution and completion distinct", () => {
    const parsed = reminderSchema.parse(reminder);
    expect(reminderLabel(parsed)).toBe("Overdue work reminder");
    expect(reminderLabel({ ...parsed, acknowledged_at: "2026-09-12T12:00:00Z" })).toBe("Reminder acknowledged");
    expect(reminderLabel({ ...parsed, state: "configuration_needed", problem: "Approved deadline needed" })).toBe("Approved deadline needed");
    expect(reminderLabel({ ...parsed, state: "resolved" })).toBe("Reminder resolved from the work record");
  });
});
