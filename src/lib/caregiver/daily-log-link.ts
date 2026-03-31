import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * When a caregiver has already opened today's daily log row for this resident/shift,
 * link new ADL rows to it (optional FK on adl_logs).
 */
export async function fetchDailyLogIdForAdlLink(
  supabase: SupabaseClient<Database>,
  args: {
    residentId: string;
    facilityId: string;
    logDate: string;
    shift: Database["public"]["Enums"]["shift_type"];
    loggedBy: string;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("resident_id", args.residentId)
    .eq("facility_id", args.facilityId)
    .eq("log_date", args.logDate)
    .eq("shift", args.shift)
    .eq("logged_by", args.loggedBy)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}
