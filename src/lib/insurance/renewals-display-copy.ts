/**
 * Quiet Operator copy for insurance renewals list surfaces.
 * Missing target effective dates name real gaps — never fabricate calendar days.
 */

import { format, parseISO } from "date-fns";
import { enumLabel } from "@/lib/display/enum-label";

export const INSURANCE_RENEWAL_NO_DATE_COPY = "No date posted";

/** Target effective date on a renewal row — never invents a calendar day. */
export function formatInsuranceRenewalTargetDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_RENEWAL_NO_DATE_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_RENEWAL_NO_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}

export const INSURANCE_RENEWAL_NO_POLICY_COPY = "Policy not recorded";
export const INSURANCE_RENEWAL_NO_ENTITY_COPY = "Entity not recorded";

export type InsuranceRenewalSubject = {
  insurance_policies: { policy_number: string | null; carrier_name: string | null; policy_type: string | null } | null;
  entities: { name: string | null } | null;
};

/**
 * What is being renewed. COL-527: the renewal cards showed a status badge, a
 * date and two premium fields and nothing else, so five workers' compensation
 * renewals spanning five legal entities and two carriers were identical on
 * screen. A renewal nobody can identify is not a renewal calendar.
 */
export function insuranceRenewalSubject(row: InsuranceRenewalSubject): string {
  const policy = row.insurance_policies;
  const number = policy?.policy_number?.trim();
  if (!policy || !number) return INSURANCE_RENEWAL_NO_POLICY_COPY;

  const line = policy.policy_type?.trim();
  const head = line
    ? `${enumLabel(line)} — ${number}`
    : number;

  const carrier = policy.carrier_name?.trim();
  return carrier ? `${head} · ${carrier}` : head;
}

/** Whose renewal it is. Named, never inferred from the policy. */
export function insuranceRenewalScope(row: InsuranceRenewalSubject): string {
  const name = row.entities?.name?.trim();
  return name ? name : INSURANCE_RENEWAL_NO_ENTITY_COPY;
}
