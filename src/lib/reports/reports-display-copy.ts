import type { EventTrigger, PackUiMeta } from "@/lib/reports/pack-ui-metadata";

/**
 * Quiet Operator copy for reports hub surfaces.
 * Missing run timestamps name real gaps — never fabricate report facts.
 */

export const REPORTS_NO_COMPLETE_TIME_COPY = "No complete time posted";
export const REPORTS_NO_METRIC_VALUE_COPY = "No value posted";
export const REPORTS_NO_NEXT_RUN_COPY = "No next run posted";
export const REPORTS_NO_SCHEDULE_COPY = "No schedule posted";

const EVENT_TRIGGER_LABELS: Record<EventTrigger, string> = {
  surveyor_arrival: "Surveyor arrival",
  board_prep: "Board meeting prep",
  manual_only: "Manual only",
};

export type ReportPackCadenceSchedule = {
  recurrence_rule: string;
  timezone: string;
  status: string;
  next_run_at: string | null;
};

function recurrenceHuman(rule: string): string {
  const r = rule.trim().toLowerCase();
  if (r === "daily") return "Daily";
  if (r === "weekly") return "Weekly";
  if (r === "monthly") return "Monthly";
  if (r === "quarterly" || r === "quarter-end") return "Quarterly";
  return rule.trim() ? rule.charAt(0).toUpperCase() + rule.slice(1).toLowerCase() : "Scheduled";
}

/** Pack cadence column on the report packs hub — names missing schedule gaps. */
export function formatReportPackCadenceSummary(
  meta: PackUiMeta | undefined,
  schedule: ReportPackCadenceSchedule | undefined,
): string {
  if (schedule?.next_run_at && schedule.status !== "paused") {
    const human = recurrenceHuman(schedule.recurrence_rule);
    return `${human} · ${schedule.timezone}`;
  }
  if (meta?.pack_kind === "event_based") {
    const t = meta.event_trigger ?? "manual_only";
    const label = EVENT_TRIGGER_LABELS[t] ?? "Event";
    return `${label} · Manual`;
  }
  if (schedule?.recurrence_rule) return recurrenceHuman(schedule.recurrence_rule);
  return REPORTS_NO_SCHEDULE_COPY;
}

/** When a report run completed — never invents a timestamp. */
export function formatReportRunCompletedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return REPORTS_NO_COMPLETE_TIME_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return REPORTS_NO_COMPLETE_TIME_COPY;
  return d.toLocaleString();
}

/** Next scheduled dispatch time — never invents a run time. */
export function formatReportScheduleNextRunAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return REPORTS_NO_NEXT_RUN_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return REPORTS_NO_NEXT_RUN_COPY;
  return d.toLocaleString();
}
