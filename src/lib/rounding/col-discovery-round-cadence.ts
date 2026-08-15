import type { PlanRuleInput } from "@/lib/rounding/types";

/** COL owner decision 2026-08-14 — Jessica Murphy binding discovery-round cadence. */
export const COL_DISCOVERY_ROUND_GRACE_MINUTES = 30;

export const COL_DISCOVERY_DAY_TIMES = ["06:00", "10:00", "14:00", "17:30"] as const;

export const COL_DISCOVERY_NIGHT_TIMES_STANDARD = ["18:00", "22:00", "05:30"] as const;

export const COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES = 120;

export const COL_DISCOVERY_FACILITY_NAMES = {
  oakridge: "Oakridge ALF",
  rising_oaks: "Rising Oaks ALF",
  grande_cypress: "Grande Cypress ALF",
  homewood: "Homewood Lodge ALF",
  plantation: "Plantation ALF",
} as const;

export type ColDiscoveryCadenceKey = keyof typeof COL_DISCOVERY_FACILITY_NAMES;

export type ColDiscoveryCadenceProfile = "standard_day_night" | "homewood_two_hour_night" | "pending";

export const COL_DISCOVERY_TEMPLATE_NAMES = {
  standard_day_night: "COL Discovery Rounds — Day + Night",
  homewood_two_hour_night: "COL Discovery Rounds — Day + Two-Hour Night",
  pending: "COL Discovery Rounds (cadence pending)",
} as const;

/** Migration 219 template names — must not remain active defaults. */
export const LEGACY_MIGRATION_219_TEMPLATE_NAMES = [
  "COL Standard 12-Hour Rounds",
  "COL Homewood Standard Day + Night Rounds",
  "COL Plantation Wing Rounds",
] as const;

/** Migration 219 facility-default interval — blocked on new plans and templates. */
export const LEGACY_MIGRATION_219_INTERVAL_MINUTES = 720;

export function resolveColDiscoveryCadenceKey(facilityName: string): ColDiscoveryCadenceKey | null {
  const normalized = facilityName.trim().toLowerCase();
  for (const [key, name] of Object.entries(COL_DISCOVERY_FACILITY_NAMES)) {
    if (name.toLowerCase() === normalized) {
      return key as ColDiscoveryCadenceKey;
    }
  }
  return null;
}

export type ColDiscoveryDefaultRulesResult = {
  profile: ColDiscoveryCadenceProfile | null;
  templateName: string | null;
  rules: PlanRuleInput[];
};

/** Facility-scoped Jessica discovery cadence for new observation plans (not migration 219 defaults). */
export function resolveColDiscoveryDefaultRules(facilityName: string): ColDiscoveryDefaultRulesResult {
  const key = resolveColDiscoveryCadenceKey(facilityName);
  if (!key) {
    return { profile: null, templateName: null, rules: [] };
  }

  const profile = getColDiscoveryCadenceProfile(key);
  return {
    profile,
    templateName: COL_DISCOVERY_TEMPLATE_NAMES[profile],
    rules: buildColDiscoveryRoundRules(profile),
  };
}

export function getColDiscoveryCadenceProfile(key: ColDiscoveryCadenceKey): ColDiscoveryCadenceProfile {
  if (key === "plantation") return "pending";
  if (key === "homewood") return "homewood_two_hour_night";
  return "standard_day_night";
}

export function daypartEndForScheduledTime(scheduledTime: string, windowMinutes = 5): string {
  const match = /^(\d{2}):(\d{2})$/.exec(scheduledTime);
  if (!match) return scheduledTime;

  const totalMinutes = Number(match[1]) * 60 + Number(match[2]) + windowMinutes;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function buildDiscreteScheduledDaypartRule(
  scheduledTime: string,
  shift: "day" | "night",
  sortOrder: number,
): PlanRuleInput {
  return {
    intervalType: "daypart",
    intervalMinutes: null,
    shift,
    daypartStart: scheduledTime,
    daypartEnd: daypartEndForScheduledTime(scheduledTime),
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: COL_DISCOVERY_ROUND_GRACE_MINUTES,
    requiredFieldsSchema: {
      scheduled_time: scheduledTime,
      shift,
      required_fields: ["resident_location", "resident_state", "quick_status"],
      vocab_source: "observation_vocab",
    },
    escalationPolicyKey: "resident-assurance-standard",
    sortOrder,
    active: true,
  };
}

export function buildColDiscoveryRoundRules(profile: ColDiscoveryCadenceProfile): PlanRuleInput[] {
  if (profile === "pending") return [];

  const rules: PlanRuleInput[] = [];
  let sortOrder = 0;

  for (const scheduledTime of COL_DISCOVERY_DAY_TIMES) {
    rules.push(buildDiscreteScheduledDaypartRule(scheduledTime, "day", sortOrder));
    sortOrder += 1;
  }

  if (profile === "homewood_two_hour_night") {
    rules.push({
      intervalType: "fixed_minutes",
      intervalMinutes: COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES,
      shift: "night",
      daypartStart: "18:00",
      daypartEnd: "06:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: COL_DISCOVERY_ROUND_GRACE_MINUTES,
      requiredFieldsSchema: {
        shift: "night",
        interval_minutes: COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES,
        required_fields: ["resident_location", "resident_state", "quick_status"],
        vocab_source: "observation_vocab",
      },
      escalationPolicyKey: "resident-assurance-standard",
      sortOrder,
      active: true,
    });
    return rules;
  }

  for (const scheduledTime of COL_DISCOVERY_NIGHT_TIMES_STANDARD) {
    rules.push(buildDiscreteScheduledDaypartRule(scheduledTime, "night", sortOrder));
    sortOrder += 1;
  }

  return rules;
}

export type ColDiscoveryPresetRule = {
  interval_type: PlanRuleInput["intervalType"];
  interval_minutes: number | null;
  shift: PlanRuleInput["shift"];
  daypart_start: string | null;
  daypart_end: string | null;
  days_of_week: number[];
  grace_minutes: number;
  required_fields_schema: Record<string, unknown>;
  escalation_policy_key: string;
  sort_order: number;
  active: boolean;
};

export function isLegacyMigration219TemplateName(name: string): boolean {
  return (LEGACY_MIGRATION_219_TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function presetRuleToPlanRule(record: ColDiscoveryPresetRule, index = 0): PlanRuleInput {
  return {
    intervalType: record.interval_type,
    intervalMinutes: record.interval_minutes,
    shift: record.shift,
    daypartStart: record.daypart_start,
    daypartEnd: record.daypart_end,
    daysOfWeek: record.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: record.grace_minutes,
    requiredFieldsSchema: record.required_fields_schema ?? {},
    escalationPolicyKey: record.escalation_policy_key,
    sortOrder: record.sort_order ?? index,
    active: record.active ?? true,
  };
}

export function planRulesFromPresetDefinition(preset: Record<string, unknown> | null | undefined): PlanRuleInput[] {
  if (!preset || isLegacyMigration219PresetDefinition(preset)) return [];
  if (preset.cadence_profile === "pending") return [];

  const rules = preset.rules;
  if (!Array.isArray(rules)) return [];

  return rules
    .map((rule, index) => {
      if (!rule || typeof rule !== "object") return null;
      return presetRuleToPlanRule(rule as ColDiscoveryPresetRule, index);
    })
    .filter((rule): rule is PlanRuleInput => rule != null);
}

export function planRuleToPresetRule(rule: PlanRuleInput): ColDiscoveryPresetRule {
  return {
    interval_type: rule.intervalType,
    interval_minutes: rule.intervalMinutes ?? null,
    shift: rule.shift ?? null,
    daypart_start: rule.daypartStart ?? null,
    daypart_end: rule.daypartEnd ?? null,
    days_of_week: rule.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
    grace_minutes: rule.graceMinutes ?? COL_DISCOVERY_ROUND_GRACE_MINUTES,
    required_fields_schema: rule.requiredFieldsSchema ?? {},
    escalation_policy_key: rule.escalationPolicyKey ?? "resident-assurance-standard",
    sort_order: rule.sortOrder ?? 0,
    active: rule.active ?? true,
  };
}

export function buildColDiscoveryPresetDefinition(profile: ColDiscoveryCadenceProfile): Record<string, unknown> {
  return {
    source: "COL owner decision 2026-08-14",
    template_type: "facility_default",
    cadence_profile: profile,
    rules: buildColDiscoveryRoundRules(profile).map(planRuleToPresetRule),
    required_fields: ["resident_location", "resident_state", "quick_status"],
    vocab_source: "observation_vocab",
  };
}

export function isDiscreteScheduledDaypartRule(rule: PlanRuleInput): boolean {
  return (
    rule.intervalType === "daypart" &&
    rule.intervalMinutes == null &&
    typeof rule.requiredFieldsSchema?.scheduled_time === "string"
  );
}

export function extractDiscreteScheduledTime(rule: PlanRuleInput): string | null {
  const value = rule.requiredFieldsSchema?.scheduled_time;
  return typeof value === "string" ? value : null;
}

export type ColDiscoveryCadenceSummary = {
  profile: ColDiscoveryCadenceProfile | null;
  headline: string;
  detail: string;
  canApply: boolean;
};

function formatScheduledTimePlain(time24: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time24);
  if (!match) return time24;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minutes === 0 ? undefined : "2-digit",
  }).format(new Date(2026, 0, 1, hours, minutes));
}

function formatScheduledTimeList(times: readonly string[]): string {
  const formatted = times.map(formatScheduledTimePlain);
  if (formatted.length === 0) return "";
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
}

export type LiveBoardEmptyCopy = {
  why: string;
  guidance: string;
  overviewCta: string;
};

export type CaregiverRoundsQueueState =
  | "no_facility"
  | "plantation_pending"
  | "no_tasks_assigned"
  | "empty_window";

export type CaregiverRoundsEmptyCopy = {
  why: string;
  guidance: string;
};

/** Derive caregiver queue gap from loaded task counts — does not invent tasks or residents. */
export function deriveCaregiverRoundsQueueState(args: {
  hasFacility: boolean;
  totalTasks: number;
  activeTaskCount: number;
  facilityName: string | null;
}): CaregiverRoundsQueueState | null {
  if (!args.hasFacility) return "no_facility";

  if (args.activeTaskCount === 0) {
    const cadence = args.facilityName ? describeColDiscoveryCadenceForFacility(args.facilityName) : null;
    if (cadence?.profile === "pending") return "plantation_pending";
    if (args.totalTasks === 0) return "no_tasks_assigned";
    return "empty_window";
  }

  return null;
}

/** Operator copy when the caregiver rounds queue has no live work in scope. */
export function describeCaregiverRoundsEmptyState(state: CaregiverRoundsQueueState): CaregiverRoundsEmptyCopy {
  switch (state) {
    case "no_facility":
      return {
        why: "No facility scoped",
        guidance:
          "Your account is not linked to a facility yet. Ask an administrator to grant facility access.",
      };
    case "plantation_pending":
      return {
        why: "Discovery rounds not active here yet",
        guidance:
          "Plantation round times are pending owner decision. Ask your charge nurse or administrator for the schedule.",
      };
    case "no_tasks_assigned":
      return {
        why: "No rounds queued for you",
        guidance:
          "Nothing is assigned to you in this queue. Ask your charge nurse or administrator to apply Jessica discovery rounds.",
      };
    case "empty_window":
      return {
        why: "No checks due in this window",
        guidance:
          "Completed or upcoming rounds may appear when the next window opens. Refresh if you expect a check right now.",
      };
  }
}

/** Copy when a caregiver opens a resident round with no active task. */
export function describeCaregiverResidentRoundEmptyState(args: {
  facilityName: string | null;
  taskQueuedLocally: boolean;
}): CaregiverRoundsEmptyCopy {
  if (args.taskQueuedLocally) {
    return {
      why: "Round queued for sync",
      guidance: "This check will upload automatically when the device reconnects.",
    };
  }

  if (args.facilityName) {
    const cadence = describeColDiscoveryCadenceForFacility(args.facilityName);
    if (cadence.profile === "pending") {
      return {
        why: "No active round for this resident",
        guidance:
          "Plantation discovery times are pending. Ask your charge nurse if a check should be open now.",
      };
    }
  }

  return {
    why: "No active round for this resident",
    guidance:
      "Nothing is due right now in your assigned queue. Return to the live queue or refresh if a check should be open.",
  };
}

/** Operator copy when the live board has no tasks in the loaded window. */
export function describeLiveBoardEmptyState(facilityName: string | null): LiveBoardEmptyCopy {
  if (!facilityName) {
    return {
      why: "No facility scoped",
      guidance: "Select a facility from the top bar to load live rounding tasks.",
      overviewCta: "Go to overview",
    };
  }

  const cadence = describeColDiscoveryCadenceForFacility(facilityName);

  if (cadence.profile === "pending") {
    return {
      why: "No live tasks in the last 12 hours.",
      guidance:
        "Plantation discovery round times are pending owner decision. Return to the Smart Rounding overview for cadence status.",
      overviewCta: "Go to overview",
    };
  }

  if (cadence.canApply) {
    return {
      why: "No live tasks in the last 12 hours.",
      guidance:
        "Apply Jessica discovery rounds from the Smart Rounding overview to generate checks for this window.",
      overviewCta: "Go to overview",
    };
  }

  return {
    why: "No live tasks in the last 12 hours.",
    guidance: "Return to the Smart Rounding overview to start a rounding cycle.",
    overviewCta: "Go to overview",
  };
}

/** One-line cadence reminder for the scoped facility on the live board. */
export function describeLiveBoardCadenceReminder(facilityName: string): string {
  const cadence = describeColDiscoveryCadenceForFacility(facilityName);
  if (cadence.profile === null) {
    return "Discovery cadence is not configured for this facility.";
  }
  return cadence.detail;
}

/** Plain-English cadence copy for operator surfaces (overview, training week). */
export function describeColDiscoveryCadenceForFacility(facilityName: string): ColDiscoveryCadenceSummary {
  const key = resolveColDiscoveryCadenceKey(facilityName);
  if (!key) {
    return {
      profile: null,
      headline: "Discovery cadence not configured",
      detail: "This facility is not on the COL Jessica discovery-round schedule.",
      canApply: false,
    };
  }

  const profile = getColDiscoveryCadenceProfile(key);
  if (profile === "pending") {
    return {
      profile,
      headline: "Discovery cadence pending",
      detail:
        "Plantation discovery round times are pending owner decision. Haven will not apply wing-stagger or 12-hour templates until Jessica confirms times.",
      canApply: false,
    };
  }

  const dayTimes = formatScheduledTimeList(COL_DISCOVERY_DAY_TIMES);
  if (profile === "homewood_two_hour_night") {
    return {
      profile,
      headline: "Jessica discovery rounds — day and two-hour night",
      detail: `Day checks at ${dayTimes}; two-hour overnight checks from 6:00 PM to 6:00 AM Eastern.`,
      canApply: true,
    };
  }

  const nightTimes = formatScheduledTimeList(COL_DISCOVERY_NIGHT_TIMES_STANDARD);
  return {
    profile,
    headline: "Jessica discovery rounds — day and night",
    detail: `Day checks at ${dayTimes}; night checks at ${nightTimes}. Times are Eastern (America/New_York).`,
    canApply: true,
  };
}

export function isLegacyMigration219PresetDefinition(preset: Record<string, unknown> | null | undefined): boolean {
  if (!preset) return false;

  if (preset.template_type === "wing_default") return true;

  const wingTimes = preset.wing_times;
  if (wingTimes != null && typeof wingTimes === "object") return true;

  const rules = preset.rules;
  if (!Array.isArray(rules)) return false;

  return rules.some((rule) => {
    if (!rule || typeof rule !== "object") return false;
    const record = rule as Record<string, unknown>;
    return record.interval_minutes === 720;
  });
}
