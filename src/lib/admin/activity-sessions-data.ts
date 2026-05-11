import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const activityProviderMethodOptions = [
  { value: "facility_staff", label: "Facility staff" },
  { value: "external", label: "External provider" },
] as const;

export type ActivityProviderMethod = (typeof activityProviderMethodOptions)[number]["value"];

export type AdminActivitySession = {
  id: string;
  activityName: string;
  facilityName: string;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  cancelled: boolean;
  providerType: ActivityProviderMethod | null;
  providerName: string | null;
  confirmedByInitials: string | null;
  confirmedAt: string | null;
};

export async function fetchRecentActivitySessions(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; sessions: AdminActivitySession[] } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("activity_sessions")
    .select("id, session_date, start_time, end_time, cancelled, provider_type, provider_name, confirmed_by_initials, confirmed_at, activities(name), facilities(name)")
    .is("deleted_at", null)
    .order("session_date", { ascending: false })
    .order("start_time", { ascending: false })
    .limit(100);

  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<{
    id: string;
    session_date: string;
    start_time: string | null;
    end_time: string | null;
    cancelled: boolean;
    provider_type: ActivityProviderMethod | null;
    provider_name: string | null;
    confirmed_by_initials: string | null;
    confirmed_at: string | null;
    activities: { name: string | null } | null;
    facilities: { name: string | null } | null;
  }>;

  return {
    ok: true,
    sessions: rows.map((row) => ({
      id: row.id,
      activityName: row.activities?.name?.trim() || "Activity",
      facilityName: row.facilities?.name?.trim() || "Facility",
      sessionDate: row.session_date,
      startTime: row.start_time,
      endTime: row.end_time,
      cancelled: row.cancelled,
      providerType: row.provider_type,
      providerName: row.provider_name,
      confirmedByInitials: row.confirmed_by_initials,
      confirmedAt: row.confirmed_at,
    })),
  };
}

export async function confirmActivitySession(
  supabase: SupabaseClient<Database>,
  input: {
    sessionId: string;
    providerType: ActivityProviderMethod;
    providerName: string;
    confirmedByInitials: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const initials = input.confirmedByInitials.trim().toUpperCase();
  if (!initials) return { ok: false, error: "Initials are required." };
  if (!input.providerName.trim()) return { ok: false, error: "Provider name is required." };

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Not authenticated." };

  const { error } = await supabase
    .from("activity_sessions")
    .update({
      provider_type: input.providerType,
      provider_name: input.providerName.trim(),
      confirmed_by_initials: initials,
      confirmed_by_user_id: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId)
    .is("deleted_at", null);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
