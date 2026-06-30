import type { SupabaseClient } from "@supabase/supabase-js";

import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export const DIET_ORDERS_HUB_LIMIT = 50;
export const DIET_RESIDENTS_HUB_LIMIT = 200;
export const DIET_MEAL_SNACK_LOG_LIMIT = 12;

export type DietaryHubDietRow = Database["public"]["Tables"]["diet_orders"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

export type DietaryHubResidentOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

export type DietaryHubMealLogRow = {
  id: string;
  resident_id: string;
  meal_date: string;
  meal_type: "breakfast" | "lunch" | "dinner";
  status: "ate" | "partial" | "refused" | "out_of_facility" | "not_observed";
  intake_percent: number | null;
  notes: string | null;
  created_at: string;
  residents: { first_name: string | null; last_name: string | null } | null;
};

export type DietaryHubSnackLogRow = {
  id: string;
  snack_at: string;
  snack_description: string | null;
  residents_offered_count: number | null;
  residents_accepted_count: number | null;
  notes: string | null;
  created_at: string;
};

export type DietaryHubBootstrap = {
  rows: DietaryHubDietRow[];
  organizationId: string | null;
  residents: DietaryHubResidentOption[];
  mealLogs: DietaryHubMealLogRow[];
  snackLogs: DietaryHubSnackLogRow[];
};

export function emptyDietaryHubBootstrap(): DietaryHubBootstrap {
  return {
    rows: [],
    organizationId: null,
    residents: [],
    mealLogs: [],
    snackLogs: [],
  };
}

export async function loadDietaryHubBootstrap(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<DietaryHubBootstrap> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
    return emptyDietaryHubBootstrap();
  }

  const [dietOrdersRes, facilityRes, residentsRes, mealLogsRes, snackLogsRes] = await Promise.all([
    supabase
      .from("diet_orders")
      .select("*, residents(first_name, last_name)")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(DIET_ORDERS_HUB_LIMIT),
    supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single(),
    supabase
      .from("residents")
      .select("id, first_name, last_name")
      .eq("facility_id", selectedFacilityId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("first_name", { ascending: true })
      .limit(DIET_RESIDENTS_HUB_LIMIT),
    supabase
      .from("meal_logs" as never)
      .select(
        "id, resident_id, meal_date, meal_type, status, intake_percent, notes, created_at, residents(first_name, last_name)",
      )
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .order("meal_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(DIET_MEAL_SNACK_LOG_LIMIT) as unknown as Promise<{ data: DietaryHubMealLogRow[] | null; error: Error | null }>,
    supabase
      .from("snack_logs" as never)
      .select(
        "id, snack_at, snack_description, residents_offered_count, residents_accepted_count, notes, created_at",
      )
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .order("snack_at", { ascending: false })
      .limit(DIET_MEAL_SNACK_LOG_LIMIT) as unknown as Promise<{ data: DietaryHubSnackLogRow[] | null; error: Error | null }>,
  ]);

  if (dietOrdersRes.error) throw dietOrdersRes.error;
  if (facilityRes.error) throw facilityRes.error;
  if (residentsRes.error) throw residentsRes.error;
  if (mealLogsRes.error) throw mealLogsRes.error;
  if (snackLogsRes.error) throw snackLogsRes.error;

  return {
    rows: (dietOrdersRes.data ?? []) as DietaryHubDietRow[],
    organizationId: facilityRes.data.organization_id,
    residents: (residentsRes.data ?? []) as DietaryHubResidentOption[],
    mealLogs: (mealLogsRes.data ?? []) as DietaryHubMealLogRow[],
    snackLogs: (snackLogsRes.data ?? []) as DietaryHubSnackLogRow[],
  };
}
