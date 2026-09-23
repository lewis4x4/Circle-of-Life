/**
 * Operator copy for the cadence and escalation settings surface.
 * Spec 25A section 6, and decision D4 on vocabulary.
 *
 * Every sentence here names what the operator can do or what the number means.
 * No migration number, table name, column name or raw enum value appears in any
 * of it, and no observation time, grace value or escalation offset appears
 * either: those are rendered from rows.
 */

import { RoundingNoticeCopy } from "@/components/rounding/RoundingNotices";
import { metricFromRead, type MetricState } from "@/lib/metrics/metric-state";
import { enumLabel } from "@/lib/display/enum-label";

export const CADENCE_SETTINGS_TITLE = "Observation cadence and escalation";

export const CADENCE_SETTINGS_SUBTITLE =
  "The observation schedule this building runs, and who hears about a check that does not happen.";

export const CADENCE_SETTINGS_LOAD_FAILED =
  "The observation schedule could not be loaded for this building. Retry, or try again in a moment.";

export const CHANGE_LOG_LOAD_FAILED =
  "The change history could not be loaded for this building. Retry, or try again in a moment.";

export const CADENCE_SETTINGS_EMPTY: RoundingNoticeCopy = {
  why: "This building has no observation schedule in force.",
  guidance: "Nothing will generate a check here until one is set. An organization administrator can start one from a template.",
};

export const LADDER_EMPTY: RoundingNoticeCopy = {
  why: "This building has no escalation ladder in force.",
  guidance: "A missed check will reach nobody until one is set.",
};

export const CHANGE_LOG_EMPTY: RoundingNoticeCopy = {
  why: "Nothing has changed here yet.",
  guidance: "Every future edit lands in this list with who made it, when, and the reason they gave.",
};

export const HISTORY_EMPTY: RoundingNoticeCopy = {
  why: "There is only one version of this schedule.",
  guidance: "Once a change is put in force, the version it replaced stays here to roll back to.",
};

/**
 * The honesty line spec 6.7 requires, rendered every time a simulation result
 * is on screen. The replay assumes staff behavior is unchanged, and staff
 * behavior changes when the schedule changes.
 */
export const SIMULATION_HONESTY_LINE =
  "This measures the proposed schedule against checks staff already recorded. Staff behavior changes when the schedule changes, so it is a measurement of the past and not a forecast.";

export const PROPOSAL_REASON_LABEL = "Why this change";

export const PROPOSAL_REASON_HELPER =
  "Required, and it stays on the record. Say what changed and why, so this reads plainly in six months.";

export const ACTIVATION_REASON_LABEL = "Why now";

export const ACTIVATION_REASON_HELPER =
  "Required. Putting a change in force is its own decision, often taken by somebody else days later.";

export const ACKNOWLEDGMENT_HELPER = "Type the building name exactly to confirm.";

export const DETACH_WARNING =
  "Editing this building directly takes it off its organization template. It will stop inheriting future template changes until it is put back on one.";

export const UNCONFIGURED_NOTE =
  "A resident day with no schedule in force reads as unmet, and its cause is a configuration gap rather than a missed check. It is counted separately and never rounded away.";

export function jurisdictionFloorLine(floor: {
  jurisdiction_key: string | null;
  label: string | null;
  minimum_windows_per_24h: number | null;
  maximum_unobserved_gap_minutes: number | null;
  citation_reference: string | null;
  floor_values_pending: boolean;
  pending_note: string | null;
}): string {
  if (!floor.jurisdiction_key) {
    return "No regulator minimum is recorded for this building's state, so the schedule is bounded only by the checks below.";
  }
  if (floor.floor_values_pending) {
    return `${floor.label ?? floor.jurisdiction_key} applies to this building, and no verified minimum has been supplied yet. Nothing is assumed in its place.`;
  }
  const parts: string[] = [];
  if (floor.minimum_windows_per_24h != null) {
    parts.push(`at least ${floor.minimum_windows_per_24h} checks per resident per day`);
  }
  if (floor.maximum_unobserved_gap_minutes != null) {
    parts.push(`no unobserved span longer than ${floor.maximum_unobserved_gap_minutes} minutes`);
  }
  const requirement = parts.length > 0 ? parts.join(", and ") : "no numeric minimum";
  const citation = floor.citation_reference ? ` Reference: ${floor.citation_reference}.` : "";
  return `${floor.label ?? floor.jurisdiction_key} requires ${requirement}.${citation}`;
}

export function templateLine(templateName: string | null): string {
  return templateName == null
    ? "Custom. This building's schedule is its own and inherits nothing."
    : `On the ${templateName} template.`;
}

/** A staff role, as an operator reads it rather than as it is stored. */
export function staffRoleLabel(raw: string): string {
  return enumLabel(raw);
}

/** A delivery channel, as an operator reads it. */
export function channelLabel(raw: string): string {
  const labels: Record<string, string> = {
    in_app: "In app",
    push: "Push",
    sms: "Text message",
  };
  return labels[raw] ?? staffRoleLabel(raw);
}

/** A version status, as an operator reads it. No raw enum value renders. */
export function versionStatusLabel(raw: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    pending_approval: "Waiting for approval",
    scheduled: "Scheduled",
    active: "In force",
    superseded: "Replaced",
  };
  return labels[raw] ?? staffRoleLabel(raw);
}

/** An effective timing option, as an operator reads it. */
export function applyModeLabel(raw: string | null): string {
  if (raw == null) return "Not recorded";
  const labels: Record<string, string> = {
    next_shift_boundary: "At the next shift boundary",
    scheduled: "Scheduled",
    immediate: "Immediately",
  };
  return labels[raw] ?? staffRoleLabel(raw);
}

/** Tile placeholder when the building has no schedule in force. */
export const NO_SCHEDULE_IN_FORCE = "No schedule in force";

/**
 * A building with no schedule in force has no checks and no unobserved span to
 * measure. Its tiles say so rather than "0 checks" and a "0 min" longest gap,
 * which reads as constant observation (COL-649).
 */
export function cadenceShapeMetric(value: number | null | undefined): MetricState<number> {
  return metricFromRead({ value, noDataReason: NO_SCHEDULE_IN_FORCE });
}

/** "Now …" hint on the preview tiles, using the same no-schedule wording. */
export function cadenceNowHint(value: number | null | undefined, format: (n: number) => string = String): string {
  const state = cadenceShapeMetric(value);
  return state.status === "value" ? `Now ${format(state.value)}` : "Now: no schedule in force";
}
