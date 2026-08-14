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
