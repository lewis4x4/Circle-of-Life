/**
 * Effective-dated operating rules (COL-710, migration 491).
 *
 * Business thresholds that used to be literals in code — the risk score bands,
 * the survey binder's look-ahead window, the compliance pass-rate alert, the
 * resident-movement back-date window (COL-750, migration 504) — are
 * rows in `public.operating_rules`, resolved by `public.haven_operating_rule`
 * (facility override first, then the organization rule, latest effective date
 * on or before the day asked about; no row falls back to the database's
 * built-in default). Owners and org admins change them on Settings →
 * Threshold targets.
 *
 * Nothing here carries a fallback value: when the rule cannot be read, the
 * caller gets null and must say so rather than guess.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { parseRiskScoreBands, type RiskScoreBands } from "./risk-bands";

export const OPERATING_RULE_KEYS = [
  "risk.score_bands",
  "survey_binder.due_window_days",
  "compliance.score_alert_below_pct",
  "resident_movement.backdate_window_days",
  "stand_up.census_reason_window_days",
  "stand_up.census_notice_lead_minutes",
  "stand_up.census_notice_roles",
  "stand_up.census_reason_options",
  "stand_up.census_notice_channels",
  "stand_up.thursday_census_vs_monday",
  "stand_up.thursday_admission_notes_to_recruiters",
  "admissions.arrival_approval_roles",
] as const;

export type OperatingRuleKey = (typeof OPERATING_RULE_KEYS)[number];

export type ResolvedOperatingRule = {
  value: unknown;
  /** Null when no row exists and the database default applied. */
  ruleId: string | null;
  effectiveFrom: string | null;
  /** Null for the organization rule. */
  facilityId: string | null;
};

type RuleRow = {
  value: unknown;
  rule_id: string | null;
  effective_from: string | null;
  facility_id: string | null;
};

/** Reads the rule in force; null when the read failed. */
export async function loadOperatingRule(
  supabase: SupabaseClient,
  input: {
    key: OperatingRuleKey;
    /** Null resolves the caller's own organization. */
    organizationId?: string | null;
    facilityId?: string | null;
    asOf?: string;
  },
): Promise<ResolvedOperatingRule | null> {
  try {
    const res = (await supabase.rpc("haven_operating_rule" as never, {
      p_organization_id: input.organizationId ?? null,
      p_facility_id: input.facilityId ?? null,
      p_rule_key: input.key,
      p_as_of: input.asOf ?? todayFacilityDateIso(),
    } as never)) as unknown as { data: RuleRow[] | RuleRow | null; error: unknown };
    if (res.error) return null;
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) return null;
    return {
      value: row.value,
      ruleId: row.rule_id,
      effectiveFrom: row.effective_from,
      facilityId: row.facility_id,
    };
  } catch {
    return null;
  }
}

/** Whole days 1–365, or null when the value is not one. */
export function parseDueWindowDays(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365 ? value : null;
}

/**
 * How many Eastern calendar days back staff may date a resident movement
 * (COL-750). 0 is a real setting: only an owner or org admin may back-date.
 */
export function parseBackdateWindowDays(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 365 ? value : null;
}

/** COL-555: days a reason keeps a Stand Up census disagreement explained (0–60). */
export function parseCensusReasonWindowDays(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 60 ? value : null;
}

/** COL-751: minutes before the Stand Up entry deadline that an open census disagreement notifies (0–1440). */
export function parseCensusNoticeLeadMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440 ? value : null;
}

/** The login roles a census notice may go to. The database trigger holds the same list. */
export const CENSUS_NOTICE_ROLE_CHOICES = ["owner", "org_admin", "facility_admin", "manager", "admin_assistant"] as const;
export type CensusNoticeRole = (typeof CENSUS_NOTICE_ROLE_CHOICES)[number];

/** COL-751: who receives census notices; null when the value is not a non-empty list of allowed roles. */
export function parseCensusNoticeRoles(value: unknown): CensusNoticeRole[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((role) => (CENSUS_NOTICE_ROLE_CHOICES as readonly unknown[]).includes(role)) ? (value as CensusNoticeRole[]) : null;
}

/**
 * COL-555: one reason an administrator may give for a Stand Up census that
 * differs from the roster. The list is a facility setting
 * (`stand_up.census_reason_options`, migration 534); keys never change meaning.
 */
export type CensusReasonOption = { key: string; label: string };

const REASON_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** The facility's reasons; null when the value is not a valid list (the database trigger enforces the same shape). */
export function parseCensusReasonOptions(value: unknown): CensusReasonOption[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const keys = new Set<string>();
  const labels = new Set<string>();
  const out: CensusReasonOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || typeof row.key !== "string" || typeof row.label !== "string") return null;
    const label = row.label;
    if (!REASON_KEY.test(row.key) || label.trim() !== label || label.length < 1 || label.length > 80) return null;
    if (keys.has(row.key) || labels.has(label.toLowerCase())) return null;
    keys.add(row.key);
    labels.add(label.toLowerCase());
    out.push({ key: row.key, label });
  }
  return out;
}

/**
 * COL-751: how a census notice is delivered. Only in-app delivery is built;
 * the database refuses push and text until they are. An empty list is a real
 * setting: no census notices for the facility.
 */
export const CENSUS_NOTICE_CHANNEL_CHOICES = ["in_app"] as const;
export type CensusNoticeChannel = (typeof CENSUS_NOTICE_CHANNEL_CHOICES)[number];
/** Channels named so the settings page can say they are not available yet. */
export const CENSUS_NOTICE_CHANNELS_NOT_BUILT = ["push", "sms"] as const;

export function parseCensusNoticeChannels(value: unknown): CensusNoticeChannel[] | null {
  if (!Array.isArray(value)) return null;
  if (new Set(value).size !== value.length) return null;
  return value.every((channel) => (CENSUS_NOTICE_CHANNEL_CHOICES as readonly unknown[]).includes(channel)) ? (value as CensusNoticeChannel[]) : null;
}

/** An on/off rule; null when the value is not a boolean. */
export function parseSwitch(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * COL-333: who may approve an arrival. The rule can narrow the list; it can
 * never empty it or add a role outside these three, so it refines the
 * approval and never waives it.
 */
export const ARRIVAL_APPROVAL_ROLE_CHOICES = ["owner", "org_admin", "facility_admin"] as const;
export type ArrivalApprovalRole = (typeof ARRIVAL_APPROVAL_ROLE_CHOICES)[number];

export function parseArrivalApprovalRoles(value: unknown): ArrivalApprovalRole[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((role) => (ARRIVAL_APPROVAL_ROLE_CHOICES as readonly unknown[]).includes(role)) ? (value as ArrivalApprovalRole[]) : null;
}

/** The facility's census reasons in force; null when they cannot be read. */
export async function loadCensusReasonOptions(
  supabase: SupabaseClient,
  input: { organizationId?: string | null; facilityId?: string | null; asOf?: string },
): Promise<CensusReasonOption[] | null> {
  const rule = await loadOperatingRule(supabase, { key: "stand_up.census_reason_options", ...input });
  return rule ? parseCensusReasonOptions(rule.value) : null;
}

/**
 * The compliance alert threshold. `{ off: true }` is a real setting (the
 * default); null means the value could not be read or is invalid.
 */
export function parseScoreAlertBelowPct(value: unknown): { off: true } | { off: false; belowPct: number } | null {
  if (value === null) return { off: true };
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100) {
    return { off: false, belowPct: value };
  }
  return null;
}

export async function loadRiskScoreBands(
  supabase: SupabaseClient,
  input: { organizationId?: string | null; facilityId?: string | null; asOf?: string },
): Promise<RiskScoreBands | null> {
  const rule = await loadOperatingRule(supabase, { key: "risk.score_bands", ...input });
  return rule ? parseRiskScoreBands(rule.value) : null;
}

export async function loadSurveyBinderDueWindowDays(
  supabase: SupabaseClient,
  input: { organizationId?: string | null; facilityId?: string | null; asOf?: string },
): Promise<number | null> {
  const rule = await loadOperatingRule(supabase, { key: "survey_binder.due_window_days", ...input });
  return rule ? parseDueWindowDays(rule.value) : null;
}

export async function loadComplianceScoreAlert(
  supabase: SupabaseClient,
  input: { organizationId?: string | null; facilityId?: string | null; asOf?: string },
): Promise<ReturnType<typeof parseScoreAlertBelowPct>> {
  const rule = await loadOperatingRule(supabase, { key: "compliance.score_alert_below_pct", ...input });
  return rule ? parseScoreAlertBelowPct(rule.value) : null;
}

/** The facility's resident-movement back-date window; null when it cannot be read. */
export async function loadMovementBackdateWindowDays(
  supabase: SupabaseClient,
  input: { organizationId?: string | null; facilityId?: string | null; asOf?: string },
): Promise<number | null> {
  const rule = await loadOperatingRule(supabase, { key: "resident_movement.backdate_window_days", ...input });
  return rule ? parseBackdateWindowDays(rule.value) : null;
}
