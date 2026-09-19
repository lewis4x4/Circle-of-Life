/**
 * Monitoring Orders: vocabulary, validation and the copy the resident record
 * renders. Spec 25A section 4.
 *
 * A Monitoring Order is a clinical instruction to observe a resident more often
 * than the standard cadence. Any staff member from Resident Aide up may enter
 * one and it takes effect immediately, so there is no pending state to model
 * here and no approval anywhere in this file.
 *
 * The word "watch" is not operator vocabulary. It is a Monitoring Order. "Watch"
 * survives in this module only as the name of a Watchlist band, which is a
 * different thing.
 *
 * No interval, grace value or bound is written here. The presets and the bounds
 * come from public.monitoring_order_interval_options and the grace comes from
 * public.monitoring_order_grace_minutes, both rows rather than constants, so an
 * administrator can change them without a deploy.
 */

import { addHours, addMinutes, differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";

export const ORDERED_BY_TYPES = [
  "physician",
  "hospital_discharge",
  "home_health_nurse",
  "hospice_nurse",
  "facility_nurse",
  "facility_admin",
] as const;

export type OrderedByType = (typeof ORDERED_BY_TYPES)[number];

export const ORDER_RECEIVED_AS = ["verbal", "written_order", "discharge_paperwork", "fax"] as const;

export type OrderReceivedAs = (typeof ORDER_RECEIVED_AS)[number];

export const REASON_CATEGORIES = [
  "post_hospital_return",
  "post_fall",
  "change_in_condition",
  "behavior",
  "skin_or_wound",
  "elopement_risk",
  "other",
] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

const ORDERED_BY_LABELS: Record<OrderedByType, string> = {
  physician: "Physician",
  hospital_discharge: "Hospital discharge",
  home_health_nurse: "Home health nurse",
  hospice_nurse: "Hospice nurse",
  facility_nurse: "Facility nurse",
  facility_admin: "Facility administrator",
};

const RECEIVED_AS_LABELS: Record<OrderReceivedAs, string> = {
  verbal: "Verbal",
  written_order: "Written order",
  discharge_paperwork: "Discharge paperwork",
  fax: "Fax",
};

const REASON_LABELS: Record<ReasonCategory, string> = {
  post_hospital_return: "Back from hospital",
  post_fall: "After a fall",
  change_in_condition: "Change in condition",
  behavior: "Behavior",
  skin_or_wound: "Skin or wound",
  elopement_risk: "Leaving the building",
  other: "Other",
};

export function orderedByLabel(value: string): string {
  return ORDERED_BY_LABELS[value as OrderedByType] ?? "Not recorded";
}

export function receivedAsLabel(value: string): string {
  return RECEIVED_AS_LABELS[value as OrderReceivedAs] ?? "Not recorded";
}

export function reasonLabel(value: string): string {
  return REASON_LABELS[value as ReasonCategory] ?? "Not recorded";
}

/** The interval presets and bounds, as read from the database. */
export type IntervalOptions = {
  presetMinutes: number[];
  minMinutes: number;
  maxMinutes: number;
};

/**
 * "Every so many minutes", "Every so many hours". Whole hours read as hours
 * because that is how the floor says them; anything else stays in minutes rather than becoming
 * an awkward fraction.
 */
export function intervalLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Interval not set";
  // date-fns rather than arithmetic on a minutes-per-hour constant, so this file
  // carries no number that reads like a cadence value.
  const epoch = new Date(0);
  const end = addMinutes(epoch, minutes);
  const wholeHours = differenceInHours(end, epoch);
  const remainder = differenceInMinutes(end, addHours(epoch, wholeHours));
  if (wholeHours > 0 && remainder === 0) {
    return wholeHours === 1 ? "Every hour" : `Every ${wholeHours} hours`;
  }
  return `Every ${minutes} minutes`;
}

export type MonitoringOrderDraft = {
  intervalMinutes: number | null;
  orderedByType: OrderedByType | "";
  orderedByName: string;
  orderReceivedAs: OrderReceivedAs | "";
  reasonCategory: ReasonCategory | "";
  reasonNote: string;
  startsAt: string;
  endsAt: string;
  reviewDueAt: string;
};

export function emptyMonitoringOrderDraft(startsAtIso: string): MonitoringOrderDraft {
  return {
    intervalMinutes: null,
    orderedByType: "",
    orderedByName: "",
    orderReceivedAs: "",
    reasonCategory: "",
    reasonNote: "",
    // The one field that arrives filled in. A Monitoring Order is a time
    // sensitive clinical event and its start is now unless the operator says
    // otherwise; a blank start on a late discharge is the worse answer.
    startsAt: startsAtIso,
    endsAt: "",
    reviewDueAt: "",
  };
}

/**
 * Everything the form can tell the operator before it asks the database. The
 * database repeats every one of these as a CHECK or a RAISE, so this is a
 * courtesy, not the gate.
 */
export function validateMonitoringOrderDraft(
  draft: MonitoringOrderDraft,
  options: IntervalOptions,
): string[] {
  const problems: string[] = [];

  if (draft.intervalMinutes == null) {
    problems.push("Choose how often the resident should be checked.");
  } else if (
    !Number.isInteger(draft.intervalMinutes) ||
    draft.intervalMinutes < options.minMinutes ||
    draft.intervalMinutes > options.maxMinutes
  ) {
    problems.push(
      `A custom interval has to be a whole number between ${options.minMinutes} and ${options.maxMinutes} minutes.`,
    );
  }

  if (!draft.orderedByType) problems.push("Say who ordered it.");
  if (draft.orderedByName.trim().length === 0) problems.push("Name the ordering person or facility.");
  if (!draft.orderReceivedAs) problems.push("Say how the order arrived.");
  if (!draft.reasonCategory) problems.push("Choose a reason.");
  if (draft.reasonNote.trim().length === 0) problems.push("Write one line about why.");
  if (draft.startsAt.trim().length === 0) problems.push("Say when it starts.");

  if (draft.endsAt.trim().length === 0 && draft.reviewDueAt.trim().length === 0) {
    problems.push("An order with no end date needs a review date, so somebody has to decide about it again.");
  }

  if (draft.endsAt.trim().length > 0 && draft.startsAt.trim().length > 0) {
    if (new Date(draft.endsAt).getTime() <= new Date(draft.startsAt).getTime()) {
      problems.push("The end has to come after the start.");
    }
  }

  return problems;
}

export type ActiveMonitoringOrder = {
  id: string;
  intervalMinutes: number;
  startsAt: string;
  endsAt: string | null;
  reviewDueAt: string | null;
  orderedByType: string;
  orderedByName: string;
  orderReceivedAs: string;
  reasonCategory: string;
  reasonNote: string;
};

export type RemainingWindow = {
  /** What the band says on its second line. */
  label: string;
  /** True when the order has run past the date somebody agreed to revisit it. */
  reviewOverdue: boolean;
};

/**
 * The remaining window, as an operator reads it. An order with an end date
 * counts down to it. An open ended order counts down to its review date, and
 * says plainly when that date has gone by, because an order nobody has revisited
 * is the thing the Watchlist raises.
 */
export function remainingWindow(order: ActiveMonitoringOrder, nowIso: string): RemainingWindow {
  const now = new Date(nowIso);

  if (order.endsAt) {
    const ends = new Date(order.endsAt);
    if (ends.getTime() <= now.getTime()) return { label: "Past its end time", reviewOverdue: false };
    return { label: `${durationLabel(now, ends)} left`, reviewOverdue: false };
  }

  if (order.reviewDueAt) {
    const review = new Date(order.reviewDueAt);
    if (review.getTime() <= now.getTime()) {
      return { label: `Open ended, review was due ${durationLabel(review, now)} ago`, reviewOverdue: true };
    }
    return { label: `Open ended, review due in ${durationLabel(now, review)}`, reviewOverdue: false };
  }

  return { label: "Open ended", reviewOverdue: false };
}

function durationLabel(from: Date, to: Date): string {
  const days = differenceInDays(to, from);
  if (days >= 1) return days === 1 ? "1 day" : `${days} days`;
  const hours = differenceInHours(to, from);
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
  const minutes = Math.max(1, differenceInMinutes(to, from));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The one line the band leads with. */
export function orderSummaryLine(order: ActiveMonitoringOrder): string {
  return `${intervalLabel(order.intervalMinutes)} · ${reasonLabel(order.reasonCategory)} · ${orderedByLabel(
    order.orderedByType,
  )}`;
}
