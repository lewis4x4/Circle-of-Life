import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { fetchResidentsFromSupabase, type ResidencyStatus, type ResidentRow } from "@/lib/residents/load-residents";
import { presenceLabel } from "@/lib/residents/presence";
import { throwIfQueryError } from "@/lib/supabase/query-error";
import type { Database } from "@/types/database";

/**
 * COL-351 out of house panel: who is at the hospital or on leave right now,
 * read through the existing resident query layer and resident RLS. This is
 * the only place resident names, rooms and ids appear on the Stand Up page;
 * nothing here is ever sent to the Stand Up API, the publisher or corporate.
 */
export type OutOfHouseStatus = Exclude<ResidencyStatus, "active">;

export type OutOfHouseRow = {
  id: string;
  name: string;
  room: string;
  status: OutOfHouseStatus;
  /** Presence label from src/lib/residents/presence.ts, the single label source. */
  label: string;
  /** Effective time of the current status, or null when history has no open row. */
  since: string | null;
};

type HistoryRow = { resident_id: string; effective_from: string };
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

const ORDER: Record<OutOfHouseStatus, number> = { hospital: 0, loa: 1 };

/** Hospital first, then leave, then the longest away first; unknown since dates last. */
export function sortOutOfHouse(rows: OutOfHouseRow[]): OutOfHouseRow[] {
  return [...rows].sort((a, b) => {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    if (a.since === b.since) return a.name.localeCompare(b.name);
    if (a.since === null) return 1;
    if (b.since === null) return -1;
    return a.since.localeCompare(b.since);
  });
}

export function buildOutOfHouse(residents: ResidentRow[], history: HistoryRow[]): OutOfHouseRow[] {
  const since = new Map<string, string>();
  for (const row of history) {
    const current = since.get(row.resident_id);
    if (!current || row.effective_from > current) since.set(row.resident_id, row.effective_from);
  }
  return sortOutOfHouse(
    residents
      .filter((resident): resident is ResidentRow & { status: OutOfHouseStatus } => resident.status !== "active")
      .map((resident) => ({
        id: resident.id,
        name: resident.name,
        room: resident.room,
        status: resident.status,
        label: presenceLabel(resident.status, resident.status === "hospital" ? resident.bedHoldStayType ?? null : undefined),
        since: since.get(resident.id) ?? null,
      })),
  );
}

export async function fetchOutOfHouse(
  facilityId: string,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<OutOfHouseRow[]> {
  const residents = (await fetchResidentsFromSupabase(facilityId, supabase)).filter((resident) => resident.status !== "active");
  if (residents.length === 0) return [];
  const result = (await supabase
    .from("resident_status_history" as never)
    .select("resident_id, effective_from")
    .in("resident_id", residents.map((resident) => resident.id))
    .is("effective_to", null)
    .is("deleted_at", null)) as unknown as QueryResult<HistoryRow>;
  throwIfQueryError(result.error, "out of house");
  return buildOutOfHouse(residents, result.data ?? []);
}

/** "Sep 12" style date in Eastern time; the page already carries the year. */
export function sinceLabel(iso: string | null): string {
  if (!iso) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(iso));
}
