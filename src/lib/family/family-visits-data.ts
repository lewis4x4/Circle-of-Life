import type { SupabaseClient } from "@supabase/supabase-js";

import { visitorTypeLabel } from "@/lib/registers/visitor-log";
import type { Database } from "@/types/database";

/**
 * Visits to one linked resident for the family portal (COL-871, migration 562).
 * Family has no read on the building's visitor log; `family_resident_visits`
 * returns only this resident's unvoided visits, shaped by the facility's
 * `family_visit_history` setting. Healthcare provider visits come back only
 * when the link can view clinical detail.
 */

export type FamilyVisitSharing = "off" | "times_only" | "with_visitor_name";

export type FamilyVisit = {
  id: string;
  arrivedAt: string;
  leftAt: string | null;
  visitorType: string;
  /** "Jordan P.", or null when the facility shares times only. */
  visitorName: string | null;
};

export type FamilyVisitsResult =
  | { ok: true; sharing: FamilyVisitSharing; visits: FamilyVisit[] }
  | { ok: false; error: string };

export const FAMILY_VISITS_LIMIT = 100;

type RpcVisit = {
  id: string;
  arrived_at: string;
  left_at: string | null;
  visitor_type: string;
  visitor_name: string | null;
};

function parseSharing(value: unknown): FamilyVisitSharing {
  return value === "off" || value === "times_only" || value === "with_visitor_name" ? value : "off";
}

export function parseFamilyVisits(payload: unknown): { sharing: FamilyVisitSharing; visits: FamilyVisit[] } {
  const body = (payload ?? {}) as { sharing?: unknown; visits?: unknown };
  const rows = Array.isArray(body.visits) ? (body.visits as RpcVisit[]) : [];
  return {
    sharing: parseSharing(body.sharing),
    visits: rows
      .filter((row) => row && typeof row.id === "string" && typeof row.arrived_at === "string")
      .map((row) => ({
        id: row.id,
        arrivedAt: row.arrived_at,
        leftAt: row.left_at ?? null,
        visitorType: row.visitor_type,
        visitorName: row.visitor_name?.trim() || null,
      })),
  };
}

export async function fetchFamilyResidentVisits(
  supabase: SupabaseClient<Database>,
  residentId: string,
): Promise<FamilyVisitsResult> {
  const { data, error } = await supabase.rpc(
    "family_resident_visits" as never,
    { p_resident_id: residentId, p_limit: FAMILY_VISITS_LIMIT } as never,
  );
  if (error) return { ok: false, error: "Visits could not be loaded right now." };
  return { ok: true, ...parseFamilyVisits(data) };
}

/** "Family or friend visited" / "Jordan P. (family or friend) visited". */
export function familyVisitTitle(visit: FamilyVisit): string {
  const kind = visitorTypeLabel(visit.visitorType);
  return visit.visitorName ? `${visit.visitorName} (${kind.toLowerCase()})` : kind;
}

const TIME_ZONE = "America/New_York";

/** "Sep 25, 7:17 PM – 8:05 PM", or "Sep 25, 7:17 PM · still here" while signed in. */
export function familyVisitWhen(visit: FamilyVisit): string {
  const arrived = new Date(visit.arrivedAt);
  if (Number.isNaN(arrived.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(arrived);
  const time = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(date);
  if (!visit.leftAt) return `${day}, ${time(arrived)} · still signed in`;
  const left = new Date(visit.leftAt);
  if (Number.isNaN(left.getTime())) return `${day}, ${time(arrived)}`;
  const leftDay = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(left);
  return leftDay === day ? `${day}, ${time(arrived)} – ${time(left)}` : `${day}, ${time(arrived)} – ${leftDay}, ${time(left)}`;
}
