import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sortBoardCheckRows,
  type BoardCheckRow,
  type BoardCheckStateRow,
} from "@/lib/facility-checks/board-check";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type BoardCheckSession = {
  id: string;
  organizationId: string;
  facilityId: string;
  startedAt: string;
  startedBy: string;
  closedAt: string | null;
  closedBy: string | null;
};

export type BoardCheckHistoryEntry = {
  id: string;
  bedId: string;
  roomNumber: string;
  bedLabel: string;
  result: string;
  recordedAt: string;
  recordedByName: string | null;
};

export type BoardCheckBootstrap = {
  session: BoardCheckSession | null;
  rows: BoardCheckRow[];
  history: BoardCheckHistoryEntry[];
  closedByName: string | null;
  error: string | null;
};

/**
 * The open walk for a facility, or the most recent closed one when there is
 * none. A facility has at most one open session at a time; the partial unique
 * index in migration 405 is what makes that true, not this query.
 */
export async function fetchBoardCheckSession(
  supabase: Client,
  facilityId: string,
): Promise<BoardCheckSession | null> {
  const { data, error } = await supabase
    .from("board_check_sessions")
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

/**
 * Bed rows with resident names attached for display only. The names come from
 * `residents`, which this caller can already read on the roster; they are never
 * written to a check result.
 */
export async function fetchBoardCheckRows(
  supabase: Client,
  sessionId: string,
): Promise<BoardCheckRow[]> {
  const { data, error } = await supabase.rpc("board_check_state", { p_session_id: sessionId });
  if (error) throw error;
  const rows = (data ?? []) as BoardCheckStateRow[];

  const residentIds = [...new Set(rows.map((row) => row.haven_resident_id).filter((id): id is string => !!id))];
  const names = await fetchResidentDisplayNames(supabase, residentIds);

  return sortBoardCheckRows(rows).map((row) => ({
    ...row,
    residentName: row.haven_resident_id ? (names.get(row.haven_resident_id) ?? null) : null,
  }));
}

async function fetchResidentDisplayNames(
  supabase: Client,
  residentIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (residentIds.length === 0) return names;
  const { data, error } = await supabase
    .from("residents")
    .select("id, first_name, last_name, preferred_name")
    .in("id", [...residentIds]);
  if (error) throw error;
  for (const row of data ?? []) {
    const given = row.preferred_name?.trim() || row.first_name;
    names.set(row.id, `${given} ${row.last_name}`.trim());
  }
  return names;
}

/**
 * Every mark in the session, newest first, superseded rows included. A result
 * is never rewritten, so the history is the whole record of the walk.
 */
export async function fetchBoardCheckHistory(
  supabase: Client,
  sessionId: string,
  rows: readonly BoardCheckRow[],
): Promise<BoardCheckHistoryEntry[]> {
  const { data, error } = await supabase
    .from("board_check_results")
    .select("id, bed_id, result, recorded_at, recorded_by")
    .eq("session_id", sessionId)
    .order("sequence", { ascending: false });
  if (error) throw error;

  const beds = new Map(rows.map((row) => [row.bed_id, row]));
  const actorIds = [...new Set((data ?? []).map((row) => row.recorded_by))];
  const actors = await fetchActorNames(supabase, actorIds);

  return (data ?? []).map((row) => ({
    id: row.id,
    bedId: row.bed_id,
    roomNumber: beds.get(row.bed_id)?.room_number ?? "",
    bedLabel: beds.get(row.bed_id)?.bed_label ?? "",
    result: row.result,
    recordedAt: row.recorded_at,
    recordedByName: actors.get(row.recorded_by) ?? null,
  }));
}

export async function fetchActorNames(
  supabase: Client,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name")
    .in("id", [...userIds]);
  if (error) throw error;
  for (const row of data ?? []) names.set(row.id, row.full_name);
  return names;
}
