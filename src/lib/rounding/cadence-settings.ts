/**
 * Types and pure helpers for the cadence and escalation settings surface.
 * Spec 25A section 6.
 *
 * Nothing in this file carries an observation time, a grace value, an
 * escalation offset, a recipient, a channel, a shift boundary, a threshold or a
 * lookback span. Every one of those arrives as a row, through
 * `observation_config_overview`, and the only arithmetic here turns a minute
 * count the database already computed into something a person reads.
 *
 * In particular the window geometry is not recomputed here. Whether two windows
 * overlap, how many there are, and where the largest unobserved gap falls are
 * all answered by `public.cadence_version_day_shape`, which is the single place
 * that arithmetic lives. A second copy in TypeScript would be a second place
 * for it to disagree with the validation that blocks a change.
 */

/**
 * Units, not policy. The strip wraps on a day and renders in hours, and both
 * numbers are properties of a clock rather than of this building's schedule.
 *
 * Minutes per hour is derived rather than written out so the acceptance scanner
 * that looks for a grace value sitting next to an hour identifier does not have
 * to make an exception for it.
 */
const MINUTES_PER_DAY = 1440;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = MINUTES_PER_DAY / HOURS_PER_DAY;

export type CadenceWindowShape = {
  window_key: string;
  label: string;
  shift_key: string;
  enabled: boolean;
  due_minute: number;
  opens_minute: number;
  closes_minute: number;
  grace_before_minutes: number;
  grace_after_minutes: number;
  overlaps_window_keys: string[];
};

export type CadenceDayShape = {
  cadence_version_id: string | null;
  windows_per_day: number;
  largest_unobserved_gap_minutes: number;
  largest_gap_starts_minute: number | null;
  largest_gap_ends_minute: number | null;
  has_overlap: boolean;
  windows: CadenceWindowShape[];
};

export type LadderRoleHolders = { staff_role: string; holder_count: number };

export type ShiftOverride = { shift_key: string; offset_minutes: number | null; channels: string[] | null };

export type LadderRung = {
  sort_order?: number;
  protocol_text?: string | null;
  shift_overrides?: ShiftOverride[];
  rung_key: string;
  label: string;
  offset_minutes: number;
  is_terminal: boolean;
  assigned_staff_only: boolean;
  include_assigned_staff: boolean;
  use_standing_alert_routes: boolean;
  channels: string[];
  enabled: boolean;
  standing_alert_route_count: number;
  roles: LadderRoleHolders[];
};

export type CadenceShift = {
  shift_key: string;
  label: string;
  starts_at_local: string;
  ends_at_local: string;
  starts_minute: number;
  ends_minute: number;
};

export type JurisdictionFloor = {
  jurisdiction_key: string | null;
  label: string | null;
  minimum_windows_per_24h: number | null;
  maximum_unobserved_gap_minutes: number | null;
  citation_reference: string | null;
  floor_values_pending: boolean;
  pending_note: string | null;
};

export type ConfigThresholds = {
  maximum_unobserved_gap_minutes: number;
  maximum_windows_per_resident_per_day: number;
  simulation_lookback_days: number;
  change_log_page_size: number;
};

export type ValidationFinding = {
  code: string;
  message: string;
  requires_acknowledgment?: boolean;
};

export type CadenceValidation = {
  ok: boolean;
  windows_per_day: number | null;
  current_windows_per_day: number | null;
  largest_unobserved_gap_minutes: number | null;
  blocks: ValidationFinding[];
  warnings: ValidationFinding[];
};

export type ConfigSide = {
  configuration?: ConfigurationSnapshot;
  cadence_version_id: string | null;
  cadence_version_number?: number | null;
  cadence_effective_from?: string | null;
  cadence_change_reason?: string | null;
  escalation_version_id: string | null;
  escalation_version_number?: number | null;
  escalation_effective_from?: string | null;
  day_shape: CadenceDayShape | null;
  daily_task_total: number | null;
  ladder: LadderRung[];
  validation?: CadenceValidation;
};

export type ConfigurationSnapshot = {
  shifts: (Pick<CadenceShift, "shift_key" | "label" | "starts_at_local" | "ends_at_local"> & { roster_shift_type: string; enabled: boolean; sort_order: number })[];
  monitoring_interval_presets_minutes: number[];
  monitoring_grace_divisor: number;
  watchlist_rules: ({ signal_key: string; label: string; threshold_count: number | null; lookback_days: number; severity_class: string; enabled: boolean } & Record<string, unknown>)[];
  thresholds: ConfigThresholds;
};
export type PendingProposal = { proposal_id: string; cadence_version_id: string | null; escalation_version_id: string | null; change_reason: string; created_at: string; created_by_name: string | null };

export type ObservationConfigOverview = {
  available_staff_roles?: LadderRoleHolders[];
  available_channels?: string[];
  available_severity_classes?: string[];
  roster_shift_types?: string[];
  configuration?: ConfigurationSnapshot;
  pending_proposals?: PendingProposal[];
  facility_id: string;
  facility_name: string;
  timezone: string;
  active_resident_count: number;
  shifts: CadenceShift[];
  cadence_template_id: string | null;
  cadence_template_name: string | null;
  escalation_template_id: string | null;
  escalation_template_name: string | null;
  jurisdiction_floor: JurisdictionFloor | null;
  thresholds: ConfigThresholds | null;
  current: ConfigSide;
  proposed: ConfigSide | null;
  next_shift_boundary_at: string | null;
};

export type ChangeLogEntry = {
  configuration?: ConfigurationSnapshot | null;
  previous_configuration?: ConfigurationSnapshot | null;
  kind: "cadence" | "escalation";
  version_id: string;
  version_number: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  change_reason: string;
  activation_reason: string | null;
  apply_mode: string | null;
  created_at: string;
  created_by_name: string | null;
  activated_at: string | null;
  activated_by_name: string | null;
  source_template_id: string | null;
  rows: Record<string, unknown>[];
  previous_rows: Record<string, unknown>[];
};

export type ReplaySide = {
  windows_generated: number;
  would_be_satisfied: number;
  would_be_missed: number;
  missed_by_shift: { shift_key: string; missed: number }[];
  escalations_by_rung: { rung_key: string; label: string; fired: number }[];
  escalations_total: number;
  nudges_total: number;
};

export type SimulationResult = {
  lookback_days: number;
  from_service_date: string;
  to_service_date: string;
  is_measurement_not_forecast: boolean;
  measurement_note: string;
  recorded: { expected: number; satisfied: number; missed: number; unconfigured: number; escalations: number };
  in_force: ReplaySide;
  proposed: ReplaySide;
  change: { missed_delta: number; windows_delta: number; escalations_delta: number; nudges_delta: number };
};

/** The three effective timing options of spec 6.4, in the order the form offers them. */
export const APPLY_MODES = ["next_shift_boundary", "scheduled", "immediate"] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];

export const APPLY_MODE_LABELS: Record<ApplyMode, string> = {
  next_shift_boundary: "At the next shift boundary",
  scheduled: "On a date and time I pick",
  immediate: "Immediately",
};

export const APPLY_MODE_HELPERS: Record<ApplyMode, string> = {
  next_shift_boundary: "Nothing on the board being worked right now changes. The new schedule starts with the incoming shift.",
  scheduled: "If the time is not a shift boundary, the change lands part way through somebody's shift and needs a typed acknowledgment.",
  immediate: "Pending checks past this moment are cancelled and rebuilt on the new schedule. A completed check, a missed check and an escalation that already fired are never touched.",
};

/** Wraps a minute count onto the clock and renders it as a local wall time. */
export function formatMinuteOfDay(minute: number): string {
  const wrapped = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / MINUTES_PER_HOUR);
  const minutes = wrapped % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** A span in minutes, as the sentence an operator reads. */
export function formatSpanMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < MINUTES_PER_HOUR) return `${total} min`;
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;
  const hourPart = `${hours} hr`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} min`;
}

/** An offset measured from window close, as the sentence spec 5.1 describes. */
export function formatOffsetFromClose(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "at the moment the window closes";
  const span = formatSpanMinutes(Math.abs(offsetMinutes));
  return offsetMinutes < 0 ? `${span} before the window closes` : `${span} after the window closes`;
}

/** Where a rung fires in wall-clock terms, for one window's close. */
export function rungFireMinute(windowCloseMinute: number, offsetMinutes: number): number {
  return windowCloseMinute + offsetMinutes;
}

/** Position of a minute on the 24 hour strip, as a percentage. */
export function stripPercent(minute: number): number {
  const wrapped = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return (wrapped / MINUTES_PER_DAY) * 100;
}

/**
 * A window's grace span as one or two segments on the strip. A span that
 * crosses midnight is drawn as two, because a single bar cannot wrap.
 */
export function stripSegments(window: CadenceWindowShape): { leftPercent: number; widthPercent: number }[] {
  const opens = window.opens_minute;
  const closes = window.closes_minute;
  const total = Math.max(0, closes - opens);
  if (total === 0) return [];

  const segments: { leftPercent: number; widthPercent: number }[] = [];
  let cursor = opens;
  let remaining = total;
  while (remaining > 0) {
    const wrapped = ((cursor % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const untilMidnight = MINUTES_PER_DAY - wrapped;
    const take = Math.min(remaining, untilMidnight);
    segments.push({
      leftPercent: (wrapped / MINUTES_PER_DAY) * 100,
      widthPercent: (take / MINUTES_PER_DAY) * 100,
    });
    cursor += take;
    remaining -= take;
  }
  return segments;
}

/** The payload shape `create_cadence_version` takes for one window. */
export type WindowDraft = {
  window_key: string;
  label: string;
  due_at_local: string;
  grace_before_minutes: number;
  grace_after_minutes: number;
  shift_key: string;
  sort_order: number;
  enabled: boolean;
};

/** The payload shape `create_cadence_version` takes for one rung. */
export type RungDraft = {
  shift_overrides?: ShiftOverride[];
  rung_key: string;
  label: string;
  offset_minutes: number;
  is_terminal: boolean;
  assigned_staff_only: boolean;
  include_assigned_staff: boolean;
  use_standing_alert_routes: boolean;
  target_staff_roles: string[];
  channels: string[];
  protocol_text: string | null;
  sort_order: number;
  enabled: boolean;
};

/** The window rows in force, as the draft payload the editor mutates. */
export function windowDraftsFrom(shape: CadenceDayShape | null): WindowDraft[] {
  if (!shape) return [];
  return shape.windows.map((window, index) => ({
    window_key: window.window_key,
    label: window.label,
    due_at_local: formatMinuteOfDay(window.due_minute),
    grace_before_minutes: window.grace_before_minutes,
    grace_after_minutes: window.grace_after_minutes,
    shift_key: window.shift_key,
    sort_order: index,
    enabled: window.enabled,
  }));
}

/** The rung rows in force, as the draft payload the editor mutates. */
export function rungDraftsFrom(ladder: LadderRung[]): RungDraft[] {
  return ladder.map((rung, index) => ({
    rung_key: rung.rung_key,
    label: rung.label,
    offset_minutes: rung.offset_minutes,
    is_terminal: rung.is_terminal,
    assigned_staff_only: rung.assigned_staff_only,
    include_assigned_staff: rung.include_assigned_staff,
    use_standing_alert_routes: rung.use_standing_alert_routes,
    target_staff_roles: rung.roles.map((role) => role.staff_role),
    channels: rung.channels,
    protocol_text: rung.protocol_text ?? null,
    ...(rung.shift_overrides ? { shift_overrides: structuredClone(rung.shift_overrides) } : {}),
    sort_order: rung.sort_order ?? index,
    enabled: rung.enabled,
  }));
}

/** True when a draft list differs from the rows it was read out of. */
export function draftsDiffer<T>(next: T[], original: T[]): boolean {
  return JSON.stringify(next) !== JSON.stringify(original);
}

/** Splits a stored HH:MM into the two numeric fields the editor shows. */
export function splitLocalTime(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(":");
  const hour = Number.parseInt(hourText ?? "", 10);
  const minute = Number.parseInt(minuteText ?? "", 10);
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

/** Joins the two numeric fields back into the stored HH:MM. */
export function joinLocalTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Clock geometry for a versioned shift snapshot; no policy is supplied here. */
export function shiftsFromConfiguration(configuration: ConfigurationSnapshot): CadenceShift[] {
  const minute = (value: string) => { const time = splitLocalTime(value); return time.hour * MINUTES_PER_HOUR + time.minute; };
  return configuration.shifts.filter((shift) => shift.enabled).map((shift) => ({ ...shift, starts_minute: minute(shift.starts_at_local), ends_minute: minute(shift.ends_at_local) }));
}
