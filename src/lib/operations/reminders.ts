import { z } from "zod";

/** No channel or recipient inputs: the command derives both from current source authority. */
export const reminderCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("refresh"), issue_id: z.string().uuid().optional() }).strict(),
  z.object({ command: z.literal("acknowledge"), expected_revision: z.string().uuid(), issue_id: z.string().uuid().optional(), request_key: z.string().min(8).max(200) }).strict(),
  z.object({ command: z.literal("snooze"), expected_revision: z.string().uuid(), issue_id: z.string().uuid().optional(), request_key: z.string().min(8).max(200), until: z.string().datetime({ offset: true }) }).strict(),
]);
export const reminderSchema = z.object({
  id: z.string().uuid(), issue_id: z.string().uuid().nullable(), source_label: z.string(), state: z.enum(["configuration_needed", "upcoming", "active", "resolved"]),
  phase: z.enum(["due", "overdue", "follow_up"]).nullable(), problem: z.string().nullable(),
  revision: z.string().uuid(), generation: z.number().int().positive(),
  acknowledged_at: z.string().nullable(), snoozed_until: z.string().nullable(),
  can_respond: z.boolean().nullable(), suppressed: z.boolean().nullable(),
  channel: z.literal("in_app"), delivery_status: z.enum(["queued", "sent"]), replayed: z.boolean(),
});
export type Reminder = z.infer<typeof reminderSchema>;
export function reminderLabel(reminder: Reminder): string {
  if (reminder.state === "configuration_needed") return reminder.problem ?? "Reminder configuration needed";
  if (reminder.state === "resolved") return "Reminder resolved from the work record";
  if (reminder.state === "upcoming") return "Reminder window has not started";
  if (reminder.acknowledged_at) return "Reminder acknowledged";
  if (reminder.suppressed) return "Reminder snoozed";
  return reminder.phase === "overdue" ? "Overdue work reminder" : reminder.phase === "follow_up" ? "Issue follow-up reminder" : "Work due reminder";
}
