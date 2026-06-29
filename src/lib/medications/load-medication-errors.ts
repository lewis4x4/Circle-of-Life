import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type MedicationErrorRow = {
  id: string;
  error_type: string;
  severity: string;
  occurred_at: string;
  reviewed_at: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

export async function fetchMedicationErrors(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<MedicationErrorRow[]> {
  if (!isValidFacilityIdForQuery(selectedFacilityId)) {
    throw new Error("Select a facility.");
  }

  const res = (await supabase
    .from("medication_errors" as never)
    .select("id, error_type, severity, occurred_at, reviewed_at")
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(150)) as unknown as QueryListResult<MedicationErrorRow>;

  if (res.error) throw res.error;
  return res.data ?? [];
}
