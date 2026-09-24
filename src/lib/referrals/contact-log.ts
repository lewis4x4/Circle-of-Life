/**
 * Referral contact log: the words and payloads behind "log everything" on a lead.
 *
 * Recruiters and referral staff record each contact (how, with whom, when, what was
 * said, the next step) through the idempotent `record_interaction` episode command and
 * read the whole episode history back. Nothing here is prefilled: the form opens empty
 * and every value is one the person typed or chose.
 */

import { enumLabel } from "@/lib/display/enum-label";
import { ROLE_LABELS } from "@/lib/rbac";
import { facilityDatetimeLocalToUtcIso, formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import type {
  ReferralEpisodeCommand,
  ReferralEpisodeHistory,
  ReferralInteractionMethod,
} from "@/lib/referrals/referral-authority";

export type ContactLogEvent = ReferralEpisodeHistory["events"][number];

export const INTERACTION_METHOD_OPTIONS: ReadonlyArray<{ value: ReferralInteractionMethod; label: string }> = [
  { value: "phone_call", label: "Phone call" },
  { value: "voicemail", label: "Left a voicemail" },
  { value: "text_message", label: "Text message" },
  { value: "email", label: "Email" },
  { value: "in_person", label: "In person" },
  { value: "video_call", label: "Video call" },
  { value: "mail", label: "Letter or mail" },
  { value: "other", label: "Other" },
];

export function interactionMethodLabel(method: string | null | undefined): string {
  const option = INTERACTION_METHOD_OPTIONS.find((candidate) => candidate.value === method);
  return option ? option.label : enumLabel(method, { empty: "Contact" });
}

/** A person the contact could have been with: the prospect, a linked contact, or someone else. */
export type ContactLogPerson = {
  /** `prospect`, `contact:<person_contact_id>` or `other`. */
  value: string;
  label: string;
  personContactId: string | null;
};

export function contactLogPeople(
  prospectName: string,
  contacts: ReadonlyArray<{ person_contact_id: string; first_name: string; last_name: string; relationship: string }>,
): ContactLogPerson[] {
  return [
    { value: "prospect", label: `${prospectName} (prospective resident)`, personContactId: null },
    ...contacts.map((contact) => ({
      value: `contact:${contact.person_contact_id}`,
      label: `${contact.first_name} ${contact.last_name} (${contact.relationship})`,
      personContactId: contact.person_contact_id,
    })),
    { value: "other", label: "Someone else", personContactId: null },
  ];
}

export type ContactLogDraft = {
  occurredAt: string;
  method: ReferralInteractionMethod | "";
  who: string;
  otherName: string;
  summary: string;
  nextAction: string;
  nextActionDue: string;
};

export function emptyContactLogDraft(): ContactLogDraft {
  return { occurredAt: "", method: "", who: "", otherName: "", summary: "", nextAction: "", nextActionDue: "" };
}

export type ContactLogErrors = Partial<Record<keyof ContactLogDraft, string>>;

export function validateContactLogDraft(draft: ContactLogDraft): ContactLogErrors {
  const errors: ContactLogErrors = {};
  if (!draft.occurredAt) errors.occurredAt = "Enter when the contact happened.";
  if (!draft.method) errors.method = "Choose how the contact happened.";
  if (!draft.who) errors.who = "Choose who the contact was with.";
  if (draft.who === "other" && !draft.otherName.trim()) errors.otherName = "Enter who the contact was with.";
  if (!draft.summary.trim()) errors.summary = "Write what was said or done.";
  const hasAction = Boolean(draft.nextAction.trim());
  const hasDue = Boolean(draft.nextActionDue);
  if (hasAction && !hasDue) errors.nextActionDue = "Enter when the next step is due.";
  if (hasDue && !hasAction) errors.nextAction = "Describe the next step, or clear its due time.";
  return errors;
}

export function buildRecordInteractionCommand(
  draft: ContactLogDraft,
  people: ReadonlyArray<ContactLogPerson>,
): Extract<ReferralEpisodeCommand, { kind: "record_interaction" }> {
  const person = people.find((candidate) => candidate.value === draft.who);
  const contactedName = draft.who === "other" ? draft.otherName.trim() : person?.label ?? null;
  const nextAction = draft.nextAction.trim();
  return {
    kind: "record_interaction",
    summary: draft.summary.trim(),
    method: draft.method || null,
    contacted_name: contactedName,
    person_contact_id: person?.personContactId ?? null,
    effective: { precision: "instant", at: facilityDatetimeLocalToUtcIso(draft.occurredAt) },
    ...(nextAction
      ? { next_action: nextAction, next_action_at: facilityDatetimeLocalToUtcIso(draft.nextActionDue) }
      : {}),
  };
}

export type NextStepDraft = { nextAction: string; nextActionDue: string };

export function validateNextStepDraft(draft: NextStepDraft): Partial<Record<keyof NextStepDraft, string>> {
  const errors: Partial<Record<keyof NextStepDraft, string>> = {};
  if (!draft.nextAction.trim()) errors.nextAction = "Describe the next step.";
  if (!draft.nextActionDue) errors.nextActionDue = "Enter when the next step is due.";
  return errors;
}

export function buildNextActionCommand(
  draft: NextStepDraft,
): Extract<ReferralEpisodeCommand, { kind: "next_action" }> {
  return {
    kind: "next_action",
    next_action: draft.nextAction.trim(),
    next_action_at: facilityDatetimeLocalToUtcIso(draft.nextActionDue),
  };
}

/** One key per attempt at one entry, so a retried save replays instead of logging twice. */
export function newContactLogRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `contact-log:${crypto.randomUUID()}`;
  }
  return `contact-log:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const EVENT_TITLES: Record<string, string> = {
  captured: "Referral received",
  assigned: "Owner assigned",
  ownership_handoff_requested: "Handoff requested",
  ownership_overridden: "Owner changed",
  coverage_accepted: "Coverage accepted",
  waiting_started: "Waiting on someone",
  review_started: "Sent for review",
  resumed: "Back in progress",
  next_action_set: "Next step set",
  interest_recorded: "Interest recorded",
  closed: "Closed",
  reopened: "Reopened",
  contact_added: "Contact added",
  contact_linked: "Contact linked",
  contact_permission_recorded: "Contact permission recorded",
  identity_merged: "Merged with another record",
  identity_split: "Split into its own record",
  identity_undo: "Record correction undone",
  compatibility_updated: "Status or tour updated",
  admission_transition: "Moved to admission",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? enumLabel(role);
}

/** When the event happened, as far as it is known. */
export function eventOccurredIso(event: ContactLogEvent): string {
  if (event.effective_precision === "instant" && event.effective_at) return event.effective_at;
  if (event.effective_precision === "date" && event.effective_date) return `${event.effective_date}T12:00:00Z`;
  return event.recorded_at;
}

/** Newest first by when it happened; the recorded order breaks ties. */
export function sortContactLogEvents(events: ReadonlyArray<ContactLogEvent>): ContactLogEvent[] {
  return [...events].sort((a, b) => {
    const byTime = Date.parse(eventOccurredIso(b)) - Date.parse(eventOccurredIso(a));
    return byTime !== 0 ? byTime : b.event_sequence - a.event_sequence;
  });
}

export type ContactLogEntryView = {
  id: string;
  title: string;
  when: string;
  by: string;
  lines: string[];
  restricted: boolean;
};

function nextStepLine(details: Record<string, unknown>): string | null {
  const action = text(details.next_action);
  if (!action) return null;
  const due = text(details.next_action_at);
  return due ? `Next step: ${action} (due ${formatFacilityTimestampEt(due)})` : `Next step: ${action}`;
}

export function describeContactLogEvent(event: ContactLogEvent): ContactLogEntryView {
  const details = event.details ?? {};
  const hasDetails = Object.keys(details).length > 0;
  const lines: string[] = [];
  let title = EVENT_TITLES[event.event_kind] ?? enumLabel(event.event_kind);
  let restricted = false;

  if (event.event_kind === "interaction_recorded") {
    title = hasDetails ? interactionMethodLabel(text(details.method)) : "Contact logged";
    if (hasDetails) {
      const who = text(details.contacted_name);
      if (who) lines.push(`With ${who}`);
      const summary = text(details.summary);
      if (summary) lines.push(summary);
      const next = nextStepLine(details);
      if (next) lines.push(next);
    } else {
      restricted = true;
    }
  } else if (event.event_kind === "next_action_set") {
    const next = nextStepLine(details);
    if (next) lines.push(next);
    else restricted = true;
  } else if (event.event_kind === "waiting_started" || event.event_kind === "review_started") {
    const reason = text(details.reason);
    if (reason) lines.push(reason);
  }

  if (event.from_status && event.from_status !== event.to_status) {
    lines.push(`Status: ${enumLabel(event.from_status)} to ${enumLabel(event.to_status)}`);
  }

  const by = event.actor_name ? `${event.actor_name}, ${roleLabel(event.actor_role)}` : roleLabel(event.actor_role);
  const occurred = eventOccurredIso(event);
  const when =
    event.effective_precision === "unknown"
      ? `Recorded ${formatFacilityTimestampEt(event.recorded_at)}`
      : event.effective_precision === "date" && event.effective_date
        ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(
            new Date(`${event.effective_date}T12:00:00Z`),
          )
        : formatFacilityTimestampEt(occurred);

  return { id: event.id, title, when, by, lines, restricted };
}
