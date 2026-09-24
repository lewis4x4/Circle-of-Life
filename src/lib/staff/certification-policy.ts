import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Certification requirements per job role, and the "expiring soon" window
 * (COL-709, COL-710; migration 489).
 *
 * Brian's ruling (2026-09-23): admins choose which job roles need which
 * certifications; owners and executives are not flagged unless their role is
 * configured. Rows are append only and effective-dated, with an organization
 * default (facility_id null) and a per-facility override — the same shape as
 * med_tech_shift_rules. A change is a new row with a reason; `required: false`
 * drops a requirement.
 *
 * The job role is `staff.staff_role` (a job title), never the login app_role.
 */
export type CertificationRequirementRule = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  staff_role: string;
  certification_type: string;
  required: boolean;
  effective_from: string;
  change_reason: string;
  created_at: string;
};

export type CertificationSettingsRule = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  expiring_soon_days: number;
  effective_from: string;
  change_reason: string;
  created_at: string;
};

export type CertificationRules = {
  requirements: CertificationRequirementRule[];
  settings: CertificationSettingsRule[];
};

/** What is in force for one facility at one instant. */
export type CertificationPolicy = {
  /** False when no requirement has ever been recorded for this scope: nobody can be judged. */
  configured: boolean;
  /** Job role → certification types it must hold. A role absent here needs none. */
  requiredTypesByRole: ReadonlyMap<string, ReadonlySet<string>>;
  /** Days before expiry a certification reads "expiring soon"; null when no window is set. */
  expiringSoonDays: number | null;
};

/** Guardrail, mirrored by the table's CHECK constraint. */
export const EXPIRING_SOON_DAYS_MIN = 7;
export const EXPIRING_SOON_DAYS_MAX = 365;

export function isValidExpiringSoonDays(days: number): boolean {
  return Number.isInteger(days) && days >= EXPIRING_SOON_DAYS_MIN && days <= EXPIRING_SOON_DAYS_MAX;
}

/** Mirrors the certification_type CHECK: lowercase letters, digits and underscores. */
export function isValidCertificationType(type: string): boolean {
  return /^[a-z0-9_]{1,64}$/.test(type);
}

function inForce<T extends { facility_id: string | null; effective_from: string }>(
  rows: T[],
  facilityId: string | null,
  at: Date,
): T | null {
  const latest = (scope: string | null) =>
    rows
      .filter((r) => r.facility_id === scope && Date.parse(r.effective_from) <= at.getTime())
      .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0] ?? null;
  return (facilityId ? latest(facilityId) : null) ?? latest(null);
}

export function resolveCertificationPolicy(
  rules: CertificationRules,
  facilityId: string | null,
  at: Date = new Date(),
): CertificationPolicy {
  const byKey = new Map<string, CertificationRequirementRule[]>();
  for (const row of rules.requirements) {
    if (row.facility_id !== null && row.facility_id !== facilityId) continue;
    const key = `${row.staff_role}\u0000${row.certification_type}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  let configured = false;
  const requiredTypesByRole = new Map<string, Set<string>>();
  for (const rows of byKey.values()) {
    const rule = inForce(rows, facilityId, at);
    if (!rule) continue;
    configured = true;
    if (!rule.required) continue;
    const types = requiredTypesByRole.get(rule.staff_role) ?? new Set<string>();
    types.add(rule.certification_type);
    requiredTypesByRole.set(rule.staff_role, types);
  }

  const window = inForce(
    rules.settings.filter((r) => r.facility_id === null || r.facility_id === facilityId),
    facilityId,
    at,
  );

  return {
    configured,
    requiredTypesByRole,
    expiringSoonDays: window?.expiring_soon_days ?? null,
  };
}

/** One resolver per load: policies per facility, computed once each. */
export function certificationPolicyResolver(
  rules: CertificationRules,
  at: Date = new Date(),
): (facilityId: string | null) => CertificationPolicy {
  const cache = new Map<string, CertificationPolicy>();
  return (facilityId) => {
    const key = facilityId ?? "";
    let policy = cache.get(key);
    if (!policy) {
      policy = resolveCertificationPolicy(rules, facilityId, at);
      cache.set(key, policy);
    }
    return policy;
  };
}

/** Organization owners and admins set the default; facility admins set their building's override. */
export function canSetOrganizationCertificationRule(appRole: string | null | undefined): boolean {
  return appRole === "owner" || appRole === "org_admin";
}

export function canSetFacilityCertificationRule(appRole: string | null | undefined): boolean {
  return canSetOrganizationCertificationRule(appRole) || appRole === "facility_admin";
}

type QueryError = { message: string };
type PageResult<T> = { data: T[] | null; error: QueryError | null };

const PAGE = 1000;
const REQUIREMENT_COLUMNS =
  "id, organization_id, facility_id, staff_role, certification_type, required, effective_from, change_reason, created_at";
const SETTINGS_COLUMNS = "id, organization_id, facility_id, expiring_soon_days, effective_from, change_reason, created_at";

async function readAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = (await supabase
      .from(table as never)
      .select(columns)
      .order("effective_from", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)) as unknown as PageResult<T>;
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Every rule the caller can read (RLS: their organization's defaults and their buildings' overrides), newest first. */
export async function loadCertificationRules(supabase: SupabaseClient): Promise<CertificationRules> {
  const [requirements, settings] = await Promise.all([
    readAll<CertificationRequirementRule>(supabase, "staff_certification_requirements", REQUIREMENT_COLUMNS),
    readAll<CertificationSettingsRule>(supabase, "staff_certification_settings", SETTINGS_COLUMNS),
  ]);
  return { requirements, settings };
}

export type NewCertificationRequirement = {
  organizationId: string;
  facilityId: string | null;
  staffRole: string;
  certificationType: string;
  required: boolean;
  effectiveFrom: Date;
  reason: string;
  createdBy: string;
};

export async function insertCertificationRequirement(
  supabase: SupabaseClient,
  rule: NewCertificationRequirement,
): Promise<void> {
  const reason = rule.reason.trim();
  if (!reason) throw new Error("Say why the requirement is changing.");
  if (!isValidCertificationType(rule.certificationType)) {
    throw new Error("Choose a certification type.");
  }
  const { error } = (await supabase.from("staff_certification_requirements" as never).insert({
    organization_id: rule.organizationId,
    facility_id: rule.facilityId,
    staff_role: rule.staffRole,
    certification_type: rule.certificationType,
    required: rule.required,
    effective_from: rule.effectiveFrom.toISOString(),
    change_reason: reason,
    created_by: rule.createdBy,
  } as never)) as unknown as { error: QueryError | null };
  if (error) throw new Error(error.message);
}

export type NewCertificationSettings = {
  organizationId: string;
  facilityId: string | null;
  expiringSoonDays: number;
  effectiveFrom: Date;
  reason: string;
  createdBy: string;
};

export async function insertCertificationSettings(
  supabase: SupabaseClient,
  rule: NewCertificationSettings,
): Promise<void> {
  const reason = rule.reason.trim();
  if (!reason) throw new Error("Say why the window is changing.");
  if (!isValidExpiringSoonDays(rule.expiringSoonDays)) {
    throw new Error(`The window must be a whole number of days from ${EXPIRING_SOON_DAYS_MIN} to ${EXPIRING_SOON_DAYS_MAX}.`);
  }
  const { error } = (await supabase.from("staff_certification_settings" as never).insert({
    organization_id: rule.organizationId,
    facility_id: rule.facilityId,
    expiring_soon_days: rule.expiringSoonDays,
    effective_from: rule.effectiveFrom.toISOString(),
    change_reason: reason,
    created_by: rule.createdBy,
  } as never)) as unknown as { error: QueryError | null };
  if (error) throw new Error(error.message);
}
