import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dischargeHubScopeLowerBoundUtc,
  type DischargeHubScope,
} from "@/lib/admin/discharge/hub-scope";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export const DISCHARGE_MED_REC_HUB_LIST_LIMIT = 150;

export type DischargeMedRecHubRow = Pick<
  Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "nurse_reconciliation_notes"
  | "pharmacist_npi"
  | "pharmacist_notes"
> & {
  residents: {
    first_name: string;
    last_name: string;
    discharge_target_date: string | null;
    hospice_status: string;
  } | null;
};

export type DischargeHubBootstrap = {
  rows: DischargeMedRecHubRow[];
  isRowsCapped: boolean;
};

export async function loadDischargeHubBootstrap(
  selectedFacilityId: string | null,
  scope: DischargeHubScope,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<DischargeHubBootstrap> {
  const scopeIsoLower = dischargeHubScopeLowerBoundUtc(scope);

  let api = supabase
    .from("discharge_med_reconciliation")
    .select(
      "id, status, updated_at, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(first_name, last_name, discharge_target_date, hospice_status)",
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId)) {
    api = api.eq("facility_id", selectedFacilityId);
  }

  if (scopeIsoLower) {
    api = api.gte("updated_at", scopeIsoLower);
  }

  const { data: list, error: listErr } = await api.limit(
    DISCHARGE_MED_REC_HUB_LIST_LIMIT + 1,
  );
  if (listErr) throw listErr;

  const loadedRows = (list ?? []) as DischargeMedRecHubRow[];

  return {
    rows: loadedRows.slice(0, DISCHARGE_MED_REC_HUB_LIST_LIMIT),
    isRowsCapped: loadedRows.length > DISCHARGE_MED_REC_HUB_LIST_LIMIT,
  };
}
