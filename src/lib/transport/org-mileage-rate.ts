import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { DEFAULT_MILEAGE_RATE_CENTS } from "./mileage-defaults";

/**
 * Effective mileage reimbursement rate for the organization (cents per mile).
 * Falls back to {@link DEFAULT_MILEAGE_RATE_CENTS} when no row exists yet.
 */
export async function getOrganizationMileageRateCents(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("organization_transport_settings")
    .select("mileage_reimbursement_rate_cents")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return DEFAULT_MILEAGE_RATE_CENTS;
  }

  const cents = data?.mileage_reimbursement_rate_cents;
  if (typeof cents === "number" && cents > 0) {
    return cents;
  }
  return DEFAULT_MILEAGE_RATE_CENTS;
}

export function formatCentsPerMileUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
