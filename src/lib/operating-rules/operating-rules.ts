/**
 * Effective-dated operating rules (COL-710, migration 491).
 *
 * Business thresholds that used to be literals in code — the risk score bands,
 * the survey binder's look-ahead window, the compliance pass-rate alert, the
 * resident-movement back-date window (COL-750, migration 503) — are
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
