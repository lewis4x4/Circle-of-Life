/** Shared list caps for admin hub pages (perf-query-04). */

export const INSURANCE_HUB_LIST_LIMIT = 150;
export const VENDOR_HUB_LIST_LIMIT = 150;

export const INSURANCE_CLAIMS_LIST_SELECT =
  "id, status, date_of_loss, incident_id, reserve_cents, paid_cents, claim_number, organization_id";

export const INSURANCE_RENEWALS_LIST_SELECT =
  "id, status, target_effective_date, quoted_premium_cents, bound_premium_cents, insurance_policy_id, organization_id";

export const INSURANCE_COI_LIST_SELECT =
  "id, holder_name, holder_type, carrier_name, expiration_date, aggregate_limit_cents, organization_id";

export const INSURANCE_LOSS_RUNS_LIST_SELECT =
  "id, period_start, period_end, total_claims_count, total_paid_cents, total_reserve_cents, organization_id";

export const INSURANCE_WORKERS_COMP_LIST_SELECT =
  "id, injury_date, status, reserve_cents, paid_cents, return_to_work_date, organization_id";

export const INSURANCE_POLICIES_LIST_SELECT =
  "id, policy_number, carrier_name, policy_type, status, effective_date, expiration_date, entity_id, premium_cents, organization_id";

export const VENDOR_CONTRACTS_LIST_SELECT =
  "id, vendor_id, title, effective_date, expiration_date, total_value_cents, organization_id";

export const VENDOR_DIRECTORY_LIST_SELECT = "id, name, category, status, organization_id";

export const VENDOR_PAYMENTS_LIST_SELECT =
  "id, vendor_id, entity_id, facility_id, amount_cents, payment_date, payment_method, organization_id";
