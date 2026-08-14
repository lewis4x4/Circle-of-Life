import type { ObservationPlanInput, PlanRuleInput } from "@/lib/rounding/types";
import { isDiscreteScheduledDaypartRule } from "@/lib/rounding/col-discovery-round-cadence";

export const MIN_RATIONALE_CHARACTERS = 30;
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 1_440;

export type RuleValidationErrors = {
  intervalMinutes?: string;
  graceMinutes?: string;
};

export type PlanSchedulePreview = {
  checksPerDay: number;
  nextChecks: Date[];
  windowStart: string | null;
  windowEnd: string | null;
  graceMinutes: number;
};

export function parseTimeToMinutes(value?: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTimeLabel(value?: string | null): string {
  const minutes = parseTimeToMinutes(value);
  if (minutes == null) return "—";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function formatPreviewTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function getRuleChecksPerDay(rule: PlanRuleInput): number {
  if (isDiscreteScheduledDaypartRule(rule)) return 1;

  const start = parseTimeToMinutes(rule.daypartStart ?? "00:00");
  const end = parseTimeToMinutes(rule.daypartEnd ?? "23:59");
  const intervalMinutes = Number(rule.intervalMinutes ?? 0);

  if (start == null || end == null) return 0;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < MIN_INTERVAL_MINUTES) return 0;
  if (end < start) return 0;

  return Math.floor((end - start) / intervalMinutes) + 1;
}

export function getNextScheduledChecks(
  rules: PlanRuleInput[],
  now: Date = new Date(),
  limit = 12,
): Date[] {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const checks: Date[] = [];

  for (const rule of rules) {
    if (rule.active === false) continue;
    if (isDiscreteScheduledDaypartRule(rule)) {
      const scheduledTime = rule.requiredFieldsSchema?.scheduled_time;
      if (typeof scheduledTime !== "string") continue;
      const minuteOfDay = parseTimeToMinutes(scheduledTime);
      if (minuteOfDay == null) continue;

      for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + dayOffset);
        candidate.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);

        if (candidate >= now && candidate <= horizon) {
          checks.push(candidate);
        }
      }
      continue;
    }

    const start = parseTimeToMinutes(rule.daypartStart ?? "00:00");
    const end = parseTimeToMinutes(rule.daypartEnd ?? "23:59");
    const intervalMinutes = Number(rule.intervalMinutes ?? 0);

    if (start == null || end == null) continue;
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < MIN_INTERVAL_MINUTES) continue;
    if (end < start) continue;

    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
      for (let minuteOfDay = start; minuteOfDay <= end; minuteOfDay += intervalMinutes) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + dayOffset);
        candidate.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);

        if (candidate >= now && candidate <= horizon) {
          checks.push(candidate);
        }
      }
    }
  }

  return checks.sort((a, b) => a.getTime() - b.getTime()).slice(0, limit);
}

export function buildPlanSchedulePreview(
  rules: PlanRuleInput[],
  now: Date = new Date(),
): PlanSchedulePreview {
  const activeRules = rules.filter((rule) => rule.active !== false);
  const windows = activeRules
    .map((rule) => ({
      start: parseTimeToMinutes(rule.daypartStart ?? "00:00"),
      end: parseTimeToMinutes(rule.daypartEnd ?? "23:59"),
    }))
    .filter((window): window is { start: number; end: number } => window.start != null && window.end != null);

  const earliestStart = windows.length > 0 ? Math.min(...windows.map((window) => window.start)) : null;
  const latestEnd = windows.length > 0 ? Math.max(...windows.map((window) => window.end)) : null;
  const firstGrace = Number(rules[0]?.graceMinutes ?? 0);

  return {
    checksPerDay: activeRules.reduce((total, rule) => total + getRuleChecksPerDay(rule), 0),
    nextChecks: getNextScheduledChecks(activeRules, now),
    windowStart: earliestStart == null ? null : minutesToTimeString(earliestStart),
    windowEnd: latestEnd == null ? null : minutesToTimeString(latestEnd),
    graceMinutes: Number.isFinite(firstGrace) ? firstGrace : 0,
  };
}

export function validateEffectiveWindow(
  effectiveFrom?: string | null,
  effectiveTo?: string | null,
): string | null {
  if (!effectiveTo) return null;

  const fromTime = effectiveFrom ? new Date(effectiveFrom).getTime() : Number.NaN;
  const toTime = new Date(effectiveTo).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime) {
    return "Effective to must be after Effective from.";
  }

  return null;
}

export function validateRationale(value?: string | null): string | null {
  const length = value?.trim().length ?? 0;
  if (length === 0) return "Rationale is required.";
  if (length < MIN_RATIONALE_CHARACTERS) {
    return `Rationale must be at least ${MIN_RATIONALE_CHARACTERS} characters.`;
  }
  return null;
}

export function validatePlanRule(rule: PlanRuleInput): RuleValidationErrors {
  const errors: RuleValidationErrors = {};
  const graceMinutes = Number(rule.graceMinutes ?? 0);

  if (isDiscreteScheduledDaypartRule(rule)) {
    if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
      errors.graceMinutes = "Grace minutes must be 0 or greater.";
    }
    return errors;
  }

  const intervalMinutes = Number(rule.intervalMinutes ?? 0);

  if (
    !Number.isFinite(intervalMinutes) ||
    intervalMinutes < MIN_INTERVAL_MINUTES ||
    intervalMinutes > MAX_INTERVAL_MINUTES
  ) {
    errors.intervalMinutes = `Interval minutes must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`;
  }

  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    errors.graceMinutes = "Grace minutes must be 0 or greater.";
  } else if (!errors.intervalMinutes && graceMinutes >= intervalMinutes) {
    errors.graceMinutes = "Grace minutes must be less than interval minutes.";
  }

  return errors;
}

export function getObservationPlanSaveBlockers(input: {
  residentId?: string | null;
  status?: ObservationPlanInput["status"] | null;
  sourceType?: ObservationPlanInput["sourceType"] | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  rationale?: string | null;
  rules: PlanRuleInput[];
}): string[] {
  const blockers: string[] = [];

  if (!input.residentId) blockers.push("Select resident");
  if (!input.status) blockers.push("Select status");
  if (!input.sourceType) blockers.push("Select source type");
  if (!input.effectiveFrom) blockers.push("Set effective from");

  const rationaleError = validateRationale(input.rationale);
  if (rationaleError) {
    blockers.push((input.rationale?.trim().length ?? 0) === 0 ? "Add rationale" : "Add 30+ character rationale");
  }

  if (validateEffectiveWindow(input.effectiveFrom, input.effectiveTo)) {
    blockers.push("Fix effective window");
  }

  if (input.rules.length === 0 || input.rules.some((rule) => hasRuleErrors(validatePlanRule(rule)))) {
    blockers.push("Fix rule validation");
  }

  return blockers;
}

export function validateObservationPlanPayload(body: ObservationPlanInput): string[] {
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    return ["At least one rule is required."];
  }

  const effectiveFromTime = body.effectiveFrom ? new Date(body.effectiveFrom).getTime() : Number.NaN;
  if (!Number.isFinite(effectiveFromTime)) {
    return ["effectiveFrom must be a valid date."];
  }

  if (body.effectiveTo) {
    const effectiveToTime = new Date(body.effectiveTo).getTime();
    if (!Number.isFinite(effectiveToTime)) {
      return ["effectiveTo must be a valid date."];
    }
  }

  const blockers = getObservationPlanSaveBlockers({
    residentId: body.residentId,
    status: body.status,
    sourceType: body.sourceType,
    effectiveFrom: body.effectiveFrom,
    effectiveTo: body.effectiveTo,
    rationale: body.rationale,
    rules: body.rules,
  });

  return blockers.map((blocker) => {
    if (blocker === "Select resident") return "residentId is required.";
    if (blocker === "Select status") return "status is required.";
    if (blocker === "Select source type") return "sourceType is required.";
    if (blocker === "Set effective from") return "effectiveFrom is required.";
    if (blocker === "Add rationale" || blocker === "Add 30+ character rationale") {
      return `rationale must be at least ${MIN_RATIONALE_CHARACTERS} characters.`;
    }
    if (blocker === "Fix effective window") return "effectiveTo must be after effectiveFrom.";
    if (blocker === "Fix rule validation") return "rules contain invalid interval or grace values.";
    return blocker;
  });
}

export function hasRuleErrors(errors: RuleValidationErrors): boolean {
  return Boolean(errors.intervalMinutes || errors.graceMinutes);
}

function minutesToTimeString(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
