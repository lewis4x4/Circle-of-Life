import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchActorNames } from "@/lib/facility-checks/load-board-check";
import { staffCheckSubjectKey, type StaffCheckStateRow } from "@/lib/facility-checks/staff-check";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type StaffCheckSession = {
  id: string;
  organizationId: string;
  facilityId: string;
  startedAt: string;
  startedBy: string;
  closedAt: string | null;
  closedBy: string | null;
};

export type StaffCheckHistoryEntry = {
  id: string;
  subjectName: string | null;
  result: string;
  duplicateOfName: string | null;
  recordedAt: string;
  recordedByName: string | null;
};

export type StaffCheckBootstrap = {
  session: StaffCheckSession | null;
  rows: StaffCheckStateRow[];
  history: StaffCheckHistoryEntry[];
  closedByName: string | null;
  error: string | null;
};

export async function fetchStaffCheckSession(
  supabase: Client,
  facilityId: string,
): Promise<StaffCheckSession | null> {
  const { data, error } = await supabase
    .from("staff_check_sessions")
    .select("id, organization_id, facility_id, started_at, started_by, closed_at, closed_by")
    .eq("facility_id", facilityId)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    facilityId: row.facility_id,
    startedAt: row.started_at,
    startedBy: row.started_by,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

export async function fetchStaffCheckRows(
  supabase: Client,
  sessionId: string,
): Promise<StaffCheckStateRow[]> {
  const { data, error } = await supabase.rpc("staff_check_state", { p_session_id: sessionId });
  if (error) throw error;
  return (data ?? []) as StaffCheckStateRow[];
}

/**
 * Every decision in the session, newest first. Subject and duplicate names come
 * from the state rows the caller can already see; a result row itself stores
 * only ids.
 */
export async function fetchStaffCheckHistory(
  supabase: Client,
  sessionId: string,
  rows: readonly StaffCheckStateRow[],
): Promise<StaffCheckHistoryEntry[]> {
  const { data, error } = await supabase
    .from("staff_check_results")
    .select(
      "id, subject_user_profile_id, subject_staff_id, result, duplicate_of_user_profile_id, duplicate_of_staff_id, recorded_at, recorded_by",
    )
    .eq("session_id", sessionId)
    .order("sequence", { ascending: false });
  if (error) throw error;

  const byKey = new Map(rows.map((row) => [staffCheckSubjectKey(row), row.display_name]));
  const actors = await fetchActorNames(supabase, [...new Set((data ?? []).map((row) => row.recorded_by))]);

  return (data ?? []).map((row) => ({
    id: row.id,
    subjectName:
      byKey.get(
        staffCheckSubjectKey({
          subject_user_profile_id: row.subject_user_profile_id,
          subject_staff_id: row.subject_staff_id,
        }),
      ) ?? null,
    result: row.result,
    duplicateOfName:
      byKey.get(
        staffCheckSubjectKey({
          subject_user_profile_id: row.duplicate_of_user_profile_id,
          subject_staff_id: row.duplicate_of_staff_id,
        }),
      ) ?? null,
    recordedAt: row.recorded_at,
    recordedByName: actors.get(row.recorded_by) ?? null,
  }));
}
