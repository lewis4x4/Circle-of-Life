import type { SupabaseClient } from "@supabase/supabase-js";

import { canClaimAllClear } from "@/lib/metrics/metric-state";

/**
 * New hires sign that they have read and understand the P&P manuals (COL-740;
 * migration 500).
 *
 * Brian's ruling (2026-09-24): onboarding only. Existing staff are never
 * flagged and nobody re-signs. Which knowledge-base manuals each job role
 * (staff.staff_role) must sign is effective-dated configuration with an
 * organization default and per-facility overrides, the same shape as the
 * certification requirements (489). A staff member owes the manuals whose rule
 * was in force on their hire date, so anyone hired before a rule never owes it.
 *
 * The database decides who owes what (`haven_onboarding_manual_status`) and
 * records sign-offs (`haven_sign_onboarding_manual`); this module shapes the
 * results and the configuration for the employee file and the settings page.
 */

/** The statement every sign-off records. */
export const ONBOARDING_MANUAL_ATTESTATION = "I have read and understand this policy and procedure manual.";

export type OnboardingManualMethod = "self" | "in_person";

/** One row of `haven_onboarding_manual_status`: a manual this person must sign. */
export type OnboardingManualStatus = {
  document_id: string;
  document_title: string;
  required_from: string;
  signoff_id: string | null;
  signed_at: string | null;
  signature_name: string | null;
  method: OnboardingManualMethod | null;
  signed_content_sha256: string | null;
  current_content_sha256: string | null;
};

export type OnboardingManualSummary =
  /** No rule applies to this person: nothing to show, nothing owed. */
  | { state: "none_required" }
  | { state: "outstanding"; required: number; signed: number; outstanding: OnboardingManualStatus[] }
  | { state: "all_signed"; required: number };

export function summarizeOnboardingManuals(rows: readonly OnboardingManualStatus[]): OnboardingManualSummary {
  if (rows.length === 0) return { state: "none_required" };
  const outstanding = rows.filter((row) => row.signoff_id === null);
  if (canClaimAllClear({ scopeSize: rows.length, issueCount: outstanding.length })) {
    return { state: "all_signed", required: rows.length };
  }
  return { state: "outstanding", required: rows.length, signed: rows.length - outstanding.length, outstanding };
}

/** The manual changed after it was signed. The sign-off stands (nobody re-signs); this only says so. */
export function manualChangedSinceSigning(row: OnboardingManualStatus): boolean {
  return (
    row.signoff_id !== null &&
    row.signed_content_sha256 !== null &&
    row.current_content_sha256 !== null &&
    row.signed_content_sha256 !== row.current_content_sha256
  );
}

type Readiness = { status: "not_configured" | "blocked" | "ready"; reasons: string[] };

/**
 * Duty readiness with the onboarding manuals folded in, matching
 * `haven.employee_duty_readiness_snapshot`: an unsigned required manual keeps a
 * hire from being ready.
 */
export function withOnboardingManuals(
  readiness: Readiness,
  /** undefined while loading; null when the read failed. Neither may read as "signed". */
  rows: readonly OnboardingManualStatus[] | null | undefined,
): Readiness {
  if (rows === null || rows === undefined) {
    const reason =
      rows === null ? "Onboarding manual sign-offs could not be checked." : "Checking onboarding manual sign-offs…";
    return readiness.status === "ready"
      ? { status: "blocked", reasons: [reason] }
      : { ...readiness, reasons: [...readiness.reasons, reason] };
  }
  const outstanding = rows.filter((row) => row.signoff_id === null);
  if (outstanding.length === 0) return readiness;
  const reasons = outstanding.map((row) => `${row.document_title}: not signed`);
  return {
    status: readiness.status === "ready" ? "blocked" : readiness.status,
    reasons: [...readiness.reasons, ...reasons],
  };
}

export function signoffMethodLabel(method: OnboardingManualMethod): string {
  return method === "self" ? "signed in their own login" : "signed in person, witnessed by a manager";
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type OnboardingManualRule = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  staff_role: string;
  document_id: string;
  required: boolean;
  effective_from: string;
  change_reason: string;
  created_at: string;
};

/** The rule in force for one (role, manual) at `at`: a facility row overrides the organization default. */
function inForce(rows: OnboardingManualRule[], facilityId: string | null, at: Date): OnboardingManualRule | null {
  const latest = (scope: string | null) =>
    rows
      .filter((r) => r.facility_id === scope && Date.parse(r.effective_from) <= at.getTime())
      .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0] ?? null;
  return (facilityId ? latest(facilityId) : null) ?? latest(null);
}

export type OnboardingManualPolicy = {
  /** False when no rule has ever been recorded for this scope. */
  configured: boolean;
  /** Job role → manuals (document ids) a hire in that role must sign. */
  manualsByRole: ReadonlyMap<string, ReadonlySet<string>>;
};

/** What a hire at `facilityId` would owe if hired at `at`. Mirrors `haven.onboarding_manuals_required`. */
export function resolveOnboardingManualPolicy(
  rules: readonly OnboardingManualRule[],
  facilityId: string | null,
  at: Date = new Date(),
): OnboardingManualPolicy {
  const byKey = new Map<string, OnboardingManualRule[]>();
  for (const row of rules) {
    if (row.facility_id !== null && row.facility_id !== facilityId) continue;
    const key = `${row.staff_role}\u0000${row.document_id}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  let configured = false;
  const manualsByRole = new Map<string, Set<string>>();
  for (const rows of byKey.values()) {
    const rule = inForce(rows, facilityId, at);
    if (!rule) continue;
    configured = true;
    if (!rule.required) continue;
    const manuals = manualsByRole.get(rule.staff_role) ?? new Set<string>();
    manuals.add(rule.document_id);
    manualsByRole.set(rule.staff_role, manuals);
  }
  return { configured, manualsByRole };
}

type QueryError = { message: string };
const PAGE = 1000;
const RULE_COLUMNS = "id, organization_id, facility_id, staff_role, document_id, required, effective_from, change_reason, created_at";

/** Every rule the caller can read (RLS: their organization's defaults and their buildings' overrides), newest first. */
export async function loadOnboardingManualRules(supabase: SupabaseClient): Promise<OnboardingManualRule[]> {
  const rows: OnboardingManualRule[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = (await supabase
      .from("onboarding_manual_requirements" as never)
      .select(RULE_COLUMNS)
      .order("effective_from", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)) as unknown as { data: OnboardingManualRule[] | null; error: QueryError | null };
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export type NewOnboardingManualRule = {
  organizationId: string;
  facilityId: string | null;
  staffRoles: readonly string[];
  documentId: string;
  required: boolean;
  effectiveFrom: Date;
  reason: string;
  createdBy: string;
};

/** One row per job role; the database refuses anything that is not a published manual of this organization. */
export async function insertOnboardingManualRules(supabase: SupabaseClient, rule: NewOnboardingManualRule): Promise<void> {
  const reason = rule.reason.trim();
  if (!reason) throw new Error("Say why the requirement is changing.");
  if (rule.staffRoles.length === 0) throw new Error("Choose at least one job role.");
  if (!rule.documentId) throw new Error("Choose a manual.");
  const { error } = (await supabase.from("onboarding_manual_requirements" as never).insert(
    rule.staffRoles.map((staffRole) => ({
      organization_id: rule.organizationId,
      facility_id: rule.facilityId,
      staff_role: staffRole,
      document_id: rule.documentId,
      required: rule.required,
      effective_from: rule.effectiveFrom.toISOString(),
      change_reason: reason,
      created_by: rule.createdBy,
    })) as never,
  )) as unknown as { error: QueryError | null };
  if (error) throw new Error(error.message);
}

/** One building's staff who owe at least one manual (`haven_onboarding_manual_overview`). */
export type OnboardingManualOverviewRow = {
  staff_id: string;
  first_name: string;
  last_name: string;
  staff_role: string;
  hire_date: string;
  required_count: number;
  signed_count: number;
};
