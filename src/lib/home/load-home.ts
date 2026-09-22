import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAdminDashboardSnapshot, type AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import { EMPTY_PRESENCE_CENSUS, fetchPresenceCensus, type PresenceCensus } from "@/lib/executive/presence-census";
import { fetchHomeCensus, type HomeCensusOnTap } from "@/lib/home/census";
import { fetchHomeOnTap, type HomeOnTapPayload } from "@/lib/home/on-tap";
import { fetchLiveBoardEscalations, fetchLiveBoardTasks } from "@/lib/rounding/live-board-fetch";
import { deriveLiveBoardCounts } from "@/lib/rounding/live-board-state";
import { liveBoardStatusCopy } from "@/lib/rounding/live-board-display-copy";
import type { Database } from "@/types/database";

export type HomeRoundingSummary = {
  available: boolean;
  /** Observation checks past their window today, including critical misses. */
  missedToday: number;
  openEscalations: number;
  lastEntryAt: string | null;
  lastEntryBy: string | null;
};

export type HomeFacilityOption = { id: string; name: string };

export type HomeInitialData = {
  feed: HomeOnTapPayload;
  snapshot: AdminDashboardSnapshot | null;
  presence: PresenceCensus;
  presenceAvailable: boolean;
  /** Latest Weekly Stand Up census figure for the building, when one exists. */
  standUpCensus: { value: number; weekStart: string } | null;
  rounding: HomeRoundingSummary;
  facilityOptions: HomeFacilityOption[];
  /** Monthly census confirmation (COL-569); null when the read is unavailable. */
  census: HomeCensusOnTap | null;
};

const EMPTY_ROUNDING: HomeRoundingSummary = { available: false, missedToday: 0, openEscalations: 0, lastEntryAt: null, lastEntryBy: null };

async function loadStandUpCensus(supabase: SupabaseClient<Database>, facilityId: string) {
  const { data, error } = await supabase
    .from("stand_up_reports" as never)
    .select("week_start, values")
    .eq("facility_id", facilityId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as { week_start: string; values: Record<string, unknown> | null };
  const raw = row.values?.current_total_census;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? { value, weekStart: row.week_start } : null;
}

async function loadRounding(supabase: SupabaseClient<Database>, facilityId: string, localDate: string): Promise<HomeRoundingSummary> {
  const [tasks, escalations] = await Promise.all([
    fetchLiveBoardTasks(supabase, facilityId, localDate, localDate),
    fetchLiveBoardEscalations(supabase, facilityId),
  ]);
  const counts = deriveLiveBoardCounts(tasks, new Set(escalations.map((row) => row.task_id)));
  const recorded = tasks
    .filter((task) => {
      const group = liveBoardStatusCopy(task.status).group;
      return group === "completed" || group === "late";
    })
    .sort((left, right) => right.due_at.localeCompare(left.due_at))[0];
  const staff = recorded?.staff;
  const lastEntryBy = staff ? (staff.preferred_name || staff.first_name || null) : null;
  return {
    available: true,
    missedToday: counts.overdue + counts.critical,
    openEscalations: escalations.length,
    lastEntryAt: recorded?.due_at ?? null,
    lastEntryBy,
  };
}

async function loadFacilityOptions(supabase: SupabaseClient<Database>): Promise<HomeFacilityOption[]> {
  const { data, error } = await supabase
    .from("facilities")
    .select("id, name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) return [];
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Everything Home composes, in parallel. The feed is required; the presence,
 * Stand Up, rounding, census and Command Center reads degrade to "unavailable" so one
 * engine's outage never blanks the queue an operator came here to clear.
 */
export async function loadHome(
  supabase: SupabaseClient<Database>,
  args: { facilityId: string; organizationId: string; now?: Date },
): Promise<HomeInitialData> {
  const feed = await fetchHomeOnTap(supabase, args.facilityId, args.now);
  const [snapshot, presence, standUp, rounding, facilityOptions, census] = await Promise.allSettled([
    fetchAdminDashboardSnapshot(args.facilityId, supabase),
    fetchPresenceCensus(supabase, args.organizationId, args.facilityId),
    loadStandUpCensus(supabase, args.facilityId),
    loadRounding(supabase, args.facilityId, feed.localDate),
    loadFacilityOptions(supabase),
    fetchHomeCensus(supabase, args.facilityId, args.now),
  ]);
  return {
    feed,
    snapshot: snapshot.status === "fulfilled" ? snapshot.value : null,
    presence: presence.status === "fulfilled" ? presence.value : EMPTY_PRESENCE_CENSUS,
    presenceAvailable: presence.status === "fulfilled",
    standUpCensus: standUp.status === "fulfilled" ? standUp.value : null,
    rounding: rounding.status === "fulfilled" ? rounding.value : EMPTY_ROUNDING,
    facilityOptions: facilityOptions.status === "fulfilled" ? facilityOptions.value : [],
    census: census.status === "fulfilled" ? census.value : null,
  };
}
