/**
 * Coverage lapses the insurance pages must not stay silent about (COL-649).
 *
 * A policy has lapsed when its term ended (expiration date before today, or
 * status `expired`/`cancelled`) and no other policy of the same type for the
 * same entity is in force today. That is a fact derived from the policy
 * records, not a business threshold. The 2026-07-19 workers' comp lapse
 * (COL-509) was visible only as "expired" pills on the policy list.
 */
import type { Database } from "@/types/database";

type PolicyStatus = Database["public"]["Enums"]["insurance_policy_status"];
type PolicyType = Database["public"]["Enums"]["insurance_policy_type"];

export type LapsePolicyInput = {
  id: string;
  entity_id: string;
  policy_type: PolicyType;
  policy_number: string;
  carrier_name: string;
  status: PolicyStatus;
  effective_date: string;
  expiration_date: string;
};

export type LapsedPolicy = LapsePolicyInput & { entity_name: string | null };

export const INSURANCE_POLICY_TYPE_LABEL: Record<PolicyType, string> = {
  general_liability: "General liability",
  property: "Property",
  workers_comp: "Workers' comp",
  auto: "Auto",
  umbrella: "Umbrella",
  directors_officers: "Directors & officers",
  cyber: "Cyber",
  epli: "Employment practices",
  professional: "Professional liability",
  other: "Other",
};

/** Columns the lapse check reads. */
export const COVERAGE_LAPSE_SELECT =
  "id, entity_id, policy_type, policy_number, carrier_name, status, effective_date, expiration_date";

function inForce(p: LapsePolicyInput, todayIso: string): boolean {
  if (p.status === "cancelled" || p.status === "draft" || p.status === "expired") return false;
  return p.effective_date <= todayIso && p.expiration_date >= todayIso;
}

function termEnded(p: LapsePolicyInput, todayIso: string): boolean {
  if (p.status === "draft") return false;
  return p.status === "expired" || p.status === "cancelled" || p.expiration_date < todayIso;
}

/**
 * Policies whose term ended with nothing of the same type in force for the
 * same entity today. Only the most recent ended term per entity + type is
 * reported, so an old renewed-then-lapsed chain appears once.
 */
export function findLapsedWithoutSuccessor(
  policies: readonly LapsePolicyInput[],
  todayIso: string,
  entityNames: ReadonlyMap<string, string> = new Map(),
): LapsedPolicy[] {
  const covered = new Set(
    policies.filter((p) => inForce(p, todayIso)).map((p) => `${p.entity_id}|${p.policy_type}`),
  );
  const latestEnded = new Map<string, LapsePolicyInput>();
  for (const p of policies) {
    if (!termEnded(p, todayIso)) continue;
    const key = `${p.entity_id}|${p.policy_type}`;
    if (covered.has(key)) continue;
    const prior = latestEnded.get(key);
    if (!prior || prior.expiration_date < p.expiration_date) latestEnded.set(key, p);
  }
  return [...latestEnded.values()]
    .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.entity_id.localeCompare(b.entity_id))
    .map((p) => ({ ...p, entity_name: entityNames.get(p.entity_id) ?? null }));
}
