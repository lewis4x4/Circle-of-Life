import { decodeScheduleRule, type ScheduleRule } from "@/lib/reports/schedule-preview";

/**
 * One status function for report runs and report schedules (COL-643).
 *
 * The runs list, the hub, the run detail page and the cron runner all read
 * these, so a run or schedule can never be "running" on one screen and
 * "interrupted" on another.
 */

/**
 * A run still "running" after this long will never finish: the browser tab or
 * cron worker that owned it is gone. Engineering timeout, not a business rule —
 * report executors finish in seconds.
 */
export const REPORT_RUN_INTERRUPTED_AFTER_MS = 30 * 60 * 1000;

/**
 * An active schedule whose next dispatch is further in the past than this has
 * not been picked up by the dispatcher. The dispatcher runs at least daily, so
 * anything older than a day plus an hour of slack has been missed.
 */
export const REPORT_SCHEDULE_OVERDUE_AFTER_MS = 25 * 60 * 60 * 1000;

export type ReportStatusTone = "muted" | "success" | "warning" | "danger" | "info";

export type ReportRunStateKind = "completed" | "failed" | "running" | "interrupted";

export type ReportRunState = { kind: ReportRunStateKind; label: string; tone: ReportStatusTone };

export function isReportRunInterrupted(
  run: { status: string; started_at: string },
  now: Date = new Date(),
): boolean {
  if (run.status !== "running") return false;
  const started = new Date(run.started_at).getTime();
  if (Number.isNaN(started)) return true;
  return now.getTime() - started > REPORT_RUN_INTERRUPTED_AFTER_MS;
}

export function deriveReportRunState(
  run: { status: string; started_at: string },
  now: Date = new Date(),
): ReportRunState {
  if (run.status === "completed") return { kind: "completed", label: "Completed", tone: "muted" };
  if (run.status === "failed") return { kind: "failed", label: "Failed", tone: "danger" };
  if (isReportRunInterrupted(run, now)) {
    return { kind: "interrupted", label: "Interrupted — run again", tone: "danger" };
  }
  return { kind: "running", label: "Running", tone: "warning" };
}

export type ReportScheduleStateKind = "active" | "overdue" | "needs_setup" | "paused" | "failed";

export type ReportScheduleState = {
  kind: ReportScheduleStateKind;
  label: string;
  tone: ReportStatusTone;
  /** Names what is wrong in plain words; null when the schedule is healthy or paused. */
  problem: string | null;
  recurrenceLabel: string;
  outputLabel: string;
};

export type ReportScheduleInput = {
  status: string;
  recurrence_rule: string;
  output_format: string;
  next_run_at: string | null;
  last_error?: string | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function capitalize(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase() : "";
}

function describeRule(rule: ScheduleRule): string {
  const frequency = capitalize(rule.frequency);
  if (rule.frequency === "daily") return `${frequency} · ${rule.timeLocal}`;
  if (rule.frequency === "weekly") return `${frequency} · ${WEEKDAYS[rule.weekday]} · ${rule.timeLocal}`;
  return `${frequency} · day ${rule.monthDay} · ${rule.timeLocal}`;
}

function tryDecode(rule: string): ScheduleRule | null {
  try {
    return decodeScheduleRule(rule);
  } catch {
    return null;
  }
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function deriveReportScheduleState(
  schedule: ReportScheduleInput,
  now: Date = new Date(),
): ReportScheduleState {
  const rule = tryDecode(schedule.recurrence_rule);
  const recurrenceLabel = rule
    ? describeRule(rule)
    : `${capitalize(schedule.recurrence_rule) || "Recurring"} — no day or time set`;
  const csv = schedule.output_format === "csv";
  const outputLabel = csv ? "CSV (saved in app)" : `${schedule.output_format.toUpperCase()} — not produced by scheduled runs`;
  const base = { recurrenceLabel, outputLabel };

  if (schedule.status === "paused") {
    return { ...base, kind: "paused", label: "Paused", tone: "muted", problem: null };
  }
  if (schedule.status === "failed") {
    return {
      ...base,
      kind: "failed",
      label: "Failed",
      tone: "danger",
      problem: schedule.last_error?.trim() || "The last scheduled run failed. Review it, then resume.",
    };
  }
  if (!rule) {
    return {
      ...base,
      kind: "needs_setup",
      label: "Needs setup",
      tone: "warning",
      problem: `Saved as "${schedule.recurrence_rule}" with no day or time, so it cannot run. Pick a day and time, then resume.`,
    };
  }
  if (!csv) {
    return {
      ...base,
      kind: "needs_setup",
      label: "Needs setup",
      tone: "warning",
      problem: `Output is ${schedule.output_format.toUpperCase()}, which scheduled runs cannot produce. Scheduled reports are saved in the app with CSV download.`,
    };
  }
  if (!schedule.next_run_at) {
    return {
      ...base,
      kind: "needs_setup",
      label: "Needs setup",
      tone: "warning",
      problem: "No next run time is set, so it cannot run. Pause and resume it to set one.",
    };
  }
  const due = new Date(schedule.next_run_at).getTime();
  if (now.getTime() - due > REPORT_SCHEDULE_OVERDUE_AFTER_MS) {
    return {
      ...base,
      kind: "overdue",
      label: "Overdue",
      tone: "danger",
      problem: `Was due ${formatDue(schedule.next_run_at)} and has not run. The report scheduler is not dispatching.`,
    };
  }
  return { ...base, kind: "active", label: "Active", tone: "success", problem: null };
}

/** Schedules that will actually run on time. Overdue and needs-setup schedules are not counted as working. */
export function isReportScheduleHealthy(schedule: ReportScheduleInput, now: Date = new Date()): boolean {
  return deriveReportScheduleState(schedule, now).kind === "active";
}

export type ScheduleListRow = ReportScheduleInput & { source_type: string; source_id: string };

/**
 * Schedule column for one template: direct template schedules plus schedules
 * of packs that include the template, judged by the same schedule state.
 */
export function deriveTemplateScheduleLabel(
  template: { id: string; slug: string },
  schedules: ScheduleListRow[],
  packTemplateIds: Map<string, Set<string>>,
  now: Date = new Date(),
): string {
  const relevant = schedules.filter((s) =>
    s.source_type === "template"
      ? s.source_id.trim() === template.id || s.source_id.trim() === template.slug
      : s.source_type === "pack" && (packTemplateIds.get(s.source_id)?.has(template.id) ?? false),
  );
  if (!relevant.length) return "Not scheduled";
  const kinds = relevant.map((s) => deriveReportScheduleState(s, now).kind);
  if (kinds.includes("active")) return "Scheduled";
  if (kinds.some((k) => k === "overdue" || k === "needs_setup" || k === "failed")) return "Schedule needs attention";
  return "Paused";
}
