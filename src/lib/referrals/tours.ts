/**
 * Referral tours: each tour is its own record with the prospect, the building and the
 * result (Brian, 2026-09-24). A reschedule closes the old tour as "rescheduled" and links
 * the new one to it, so a reschedule chain has one live tour and is never counted twice.
 *
 * Every form here opens empty: the time, who gives the tour and the result are what the
 * person typed or chose, never a default.
 */

import { enumLabel } from "@/lib/display/enum-label";
import { facilityDatetimeLocalToUtcIso, formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import type { ReferralTour, ReferralTourCommand, ReferralTourOutcome } from "@/lib/referrals/referral-authority";

const OUTCOME_OVERRIDES: Readonly<Record<string, string>> = {
  no_show: "No-show",
};

export function tourOutcomeLabel(outcome: ReferralTourOutcome | string | null | undefined): string {
  return enumLabel(outcome, { overrides: OUTCOME_OVERRIDES, empty: "Scheduled" });
}

/** The results a person can record on a scheduled tour. Rescheduling has its own action. */
export const TOUR_RESULT_OPTIONS: ReadonlyArray<{ value: "completed" | "cancelled" | "no_show"; label: string }> = [
  { value: "completed", label: tourOutcomeLabel("completed") },
  { value: "cancelled", label: tourOutcomeLabel("cancelled") },
  { value: "no_show", label: tourOutcomeLabel("no_show") },
];

/** What a staff member reads as a tour's state; a past tour with no result says so. */
export function tourStateLabel(tour: Pick<ReferralTour, "outcome" | "scheduled_for">, now: Date): string {
  if (tour.outcome === "scheduled" && tour.scheduled_for && Date.parse(tour.scheduled_for) < now.getTime()) {
    return "Result not recorded";
  }
  return tourOutcomeLabel(tour.outcome);
}

/** Tours that count: a reschedule chain counts once, through its live tour. */
export function countedTours<T extends Pick<ReferralTour, "outcome">>(tours: ReadonlyArray<T>): T[] {
  return tours.filter((tour) => tour.outcome !== "rescheduled");
}

export type ScheduleTourDraft = { scheduledFor: string; ownerUserId: string };
export type RescheduleTourDraft = { scheduledFor: string; ownerUserId: string; note: string };
export type TourResultDraft = { outcome: "" | "completed" | "cancelled" | "no_show"; completedAt: string; feedback: string };

export function emptyScheduleTourDraft(): ScheduleTourDraft {
  return { scheduledFor: "", ownerUserId: "" };
}

export function emptyRescheduleTourDraft(): RescheduleTourDraft {
  return { scheduledFor: "", ownerUserId: "", note: "" };
}

export function emptyTourResultDraft(): TourResultDraft {
  return { outcome: "", completedAt: "", feedback: "" };
}

export type DraftErrors<T> = Partial<Record<keyof T, string>>;

export function validateScheduleTourDraft(draft: ScheduleTourDraft): DraftErrors<ScheduleTourDraft> {
  const errors: DraftErrors<ScheduleTourDraft> = {};
  if (!draft.scheduledFor) errors.scheduledFor = "Enter when the tour is scheduled.";
  if (!draft.ownerUserId) errors.ownerUserId = "Choose who gives the tour.";
  return errors;
}

/** A tour copied from the old lead fields may have no one recorded as giving it. */
export function validateRescheduleTourDraft(
  draft: RescheduleTourDraft,
  tour: Pick<ReferralTour, "owner_user_id">,
): DraftErrors<RescheduleTourDraft> {
  const errors: DraftErrors<RescheduleTourDraft> = {};
  if (!draft.scheduledFor) errors.scheduledFor = "Enter the new time.";
  if (!draft.ownerUserId && !tour.owner_user_id) errors.ownerUserId = "Choose who gives the tour.";
  return errors;
}

export function validateTourResultDraft(draft: TourResultDraft, now: Date): DraftErrors<TourResultDraft> {
  const errors: DraftErrors<TourResultDraft> = {};
  if (!draft.outcome) errors.outcome = "Choose what happened.";
  if (draft.outcome === "completed") {
    if (!draft.completedAt) {
      errors.completedAt = "Enter when the tour was completed.";
    } else if (Date.parse(facilityDatetimeLocalToUtcIso(draft.completedAt)) > now.getTime()) {
      errors.completedAt = "A completed tour cannot finish in the future.";
    }
  }
  return errors;
}

export function buildScheduleTourCommand(draft: ScheduleTourDraft): Extract<ReferralTourCommand, { kind: "schedule" }> {
  return {
    kind: "schedule",
    scheduled_for: facilityDatetimeLocalToUtcIso(draft.scheduledFor),
    owner_user_id: draft.ownerUserId,
  };
}

export function buildRescheduleTourCommand(
  tourId: string,
  draft: RescheduleTourDraft,
): Extract<ReferralTourCommand, { kind: "reschedule" }> {
  const note = draft.note.trim();
  return {
    kind: "reschedule",
    tour_id: tourId,
    scheduled_for: facilityDatetimeLocalToUtcIso(draft.scheduledFor),
    ...(draft.ownerUserId ? { owner_user_id: draft.ownerUserId } : {}),
    ...(note ? { feedback_note: note } : {}),
  };
}

export function buildTourResultCommand(
  tourId: string,
  draft: TourResultDraft,
): Extract<ReferralTourCommand, { kind: "record_outcome" }> {
  if (!draft.outcome) throw new Error("Choose what happened.");
  const feedback = draft.feedback.trim();
  return {
    kind: "record_outcome",
    tour_id: tourId,
    outcome: draft.outcome,
    ...(draft.outcome === "completed" ? { completed_at: facilityDatetimeLocalToUtcIso(draft.completedAt) } : {}),
    ...(feedback ? { feedback_note: feedback } : {}),
  };
}

/** One key per attempt at one entry, so a retried save replays instead of recording twice. */
export function newTourRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `tour:${crypto.randomUUID()}`;
  }
  return `tour:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Title and lines for a tour entry in the lead's history. Empty details mean the reader may not see them. */
export function describeTourEvent(details: Record<string, unknown>): { title: string; lines: string[] } {
  const action = text(details.action);
  const scheduled = text(details.scheduled_for);
  const owner = text(details.owner_name);
  const lines: string[] = [];
  let title = "Tour";
  if (action === "schedule") {
    title = "Tour scheduled";
    if (scheduled) lines.push(`For ${formatFacilityTimestampEt(scheduled)}`);
    if (owner) lines.push(`Given by ${owner}`);
  } else if (action === "reschedule") {
    title = "Tour rescheduled";
    const previous = text(details.previous_scheduled_for);
    if (scheduled) {
      lines.push(previous ? `Moved from ${formatFacilityTimestampEt(previous)} to ${formatFacilityTimestampEt(scheduled)}` : `Moved to ${formatFacilityTimestampEt(scheduled)}`);
    }
    if (owner) lines.push(`Given by ${owner}`);
  } else if (action === "record_outcome") {
    title = `Tour result: ${tourOutcomeLabel(text(details.outcome))}`;
    if (scheduled) lines.push(`Tour of ${formatFacilityTimestampEt(scheduled)}`);
    const completed = text(details.completed_at);
    if (completed) lines.push(`Completed ${formatFacilityTimestampEt(completed)}`);
  }
  const note = text(details.feedback_note);
  if (note) lines.push(note);
  return { title, lines };
}
