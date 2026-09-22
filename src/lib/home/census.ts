import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Monthly census confirmation on Home (COL-569, migration 460). On the
 * facility's first business day the operator confirms last month's census, or
 * says what is wrong and keeps it open. Counts only. No schema library here:
 * the writer ships in the client bundle next to the claim RPC.
 */

export type HomeCensusSnapshot = {
  daysInMonth?: number;
  daysLogged?: number;
  averageOccupied?: number | null;
  monthEndOccupied?: number | null;
  admissions?: number;
  discharges?: number;
  licensedBeds?: number | null;
  rosterCensus?: number | null;
};

export type HomeCensusOnTap = {
  due: boolean;
  censusMonth: string;
  firstBusinessDay: string;
  status: "open" | "flagged" | "confirmed" | null;
  canRecord: boolean;
  snapshot: HomeCensusSnapshot | null;
  confirmed: { at: string; by: string | null } | null;
  lastFlag: { at: string; by: string | null; note: string | null } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseHomeCensusOnTap(data: unknown): HomeCensusOnTap | null {
  if (!isRecord(data) || typeof data.due !== "boolean" || !str(data.censusMonth)) return null;
  const status = data.status === "open" || data.status === "flagged" || data.status === "confirmed" ? data.status : null;
  const snap = isRecord(data.snapshot) ? data.snapshot : null;
  const confirmed = isRecord(data.confirmed) && str(data.confirmed.at) ? { at: str(data.confirmed.at) as string, by: str(data.confirmed.by) } : null;
  const flag = isRecord(data.lastFlag) && str(data.lastFlag.at)
    ? { at: str(data.lastFlag.at) as string, by: str(data.lastFlag.by), note: str(data.lastFlag.note) }
    : null;
  return {
    due: data.due,
    censusMonth: str(data.censusMonth) as string,
    firstBusinessDay: str(data.firstBusinessDay) ?? "",
    status,
    canRecord: data.canRecord === true,
    snapshot: snap
      ? {
          daysInMonth: num(snap.daysInMonth) ?? undefined,
          daysLogged: num(snap.daysLogged) ?? undefined,
          averageOccupied: num(snap.averageOccupied),
          monthEndOccupied: num(snap.monthEndOccupied),
          admissions: num(snap.admissions) ?? undefined,
          discharges: num(snap.discharges) ?? undefined,
          licensedBeds: num(snap.licensedBeds),
          rosterCensus: num(snap.rosterCensus),
        }
      : null,
    confirmed,
    lastFlag: flag,
  };
}

export async function fetchHomeCensus(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  asOf?: Date,
): Promise<HomeCensusOnTap | null> {
  const { data, error } = await supabase.rpc("home_census_on_tap", {
    p_facility_id: facilityId,
    ...(asOf ? { p_as_of: asOf.toISOString() } : {}),
  });
  if (error) throw new Error(error.message);
  return parseHomeCensusOnTap(data);
}

/** Confirm, or "Something wrong" with a note. The server freezes the counts and stamps the actor. */
export async function recordHomeCensus(
  supabase: SupabaseClient<Database>,
  args: { facilityId: string; censusMonth: string; outcome: "confirmed" | "flagged"; note?: string },
): Promise<void> {
  const { error } = await supabase.rpc("home_record_census", {
    p_facility_id: args.facilityId,
    p_census_month: args.censusMonth,
    p_outcome: args.outcome,
    ...(args.note ? { p_note: args.note } : {}),
  });
  if (error) throw new Error(error.message);
}
