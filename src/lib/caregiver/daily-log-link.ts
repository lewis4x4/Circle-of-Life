import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * When the signed-in user already has a daily_logs row for this resident/date/shift,
 * return its id so ADL / behavioral rows can attach (optional FKs).
 */
export async function fetchShiftDailyLogId(
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
