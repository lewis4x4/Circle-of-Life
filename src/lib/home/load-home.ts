import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAdminDashboardSnapshot, type AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import { EMPTY_PRESENCE_CENSUS, fetchPresenceCensus, type PresenceCensus } from "@/lib/executive/presence-census";
import { fetchHomeCensus, type HomeCensusOnTap } from "@/lib/home/census";
import { fetchHomeOnTap, type HomeOnTapPayload } from "@/lib/home/on-tap";
import { fetchNotesOnTap, type HomeNoteOnTap } from "@/lib/home/notes";
import { fetchHomePastDue, type HomePastDue } from "@/lib/home/past-due";
import { fetchLiveBoardEscalations, fetchLiveBoardTasks } from "@/lib/rounding/live-board-fetch";
import { deriveLiveBoardCounts } from "@/lib/rounding/live-board-state";
import { liveBoardStatusCopy } from "@/lib/rounding/live-board-display-copy";
import type { Database, Json } from "@/types/database";

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
  /** Home modules switched on for this facility (COL-594); empty when the read fails, so nothing unreleased appears. */
  releasedModules: string[];
  /**
   * Past-due rent, read only when past_due is released for the facility so no
   * balance reaches the page before then; null when unreleased or unavailable.
   */
  pastDue: HomePastDue | null;
  /** Note tasks on tap for the caller (COL-595); read only when quick_note is released. */
  notesOnTap: HomeNoteOnTap[];
};

const EMPTY_ROUNDING: HomeRoundingSummary = { available: false, missedToday: 0, openEscalations: 0, lastEntryAt: null, lastEntryBy: null };

/**
 * The latest Stand Up census figure for one facility, from the workspace's own
 * `stand_up_command('list')` payload (newest week first). stand_up_reports has
 * no browser grants, so a direct table read always came back empty (COL-603).
 */
export function latestStandUpCensus(data: unknown, facilityId: string): { value: number; weekStart: string } | null {
  const reports = (data as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(reports)) return null;
  const rows = reports
    .filter((row): row is { facility_id: string; week_start: string; values?: Record<string, unknown> | null } =>
      Boolean(row) && typeof row === "object" && (row as { facility_id?: unknown }).facility_id === facilityId
      && typeof (row as { week_start?: unknown }).week_start === "string")
    .sort((left, right) => right.week_start.localeCompare(left.week_start));
  for (const row of rows) {
    const raw = row.values?.current_total_census;
    if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw, weekStart: row.week_start };
  }
  return null;
}

async function loadStandUpCensus(supabase: SupabaseClient<Database>, facilityId: string) {
  // Migration-owned RPC is intentionally additive to the generated schema (see lib/stand-up/server.ts).
  // Answers for owner, org_admin and facility_admin with facility access; anyone else is refused and the tile shows nothing extra.
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: { p_action: string; p_payload: Json }) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc("stand_up_command", { p_action: "list", p_payload: { facility_id: facilityId } });
  if (error) return null;
  return latestStandUpCensus(data, facilityId);
}

async function loadReleasedModules(supabase: SupabaseClient<Database>, facilityId: string): Promise<string[]> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: { p_facility_id: string }) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc("home_released_modules", { p_facility_id: facilityId });
  if (error || !Array.isArray(data)) return [];
  return data.filter((value): value is string => typeof value === "string");
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
  const [snapshot, presence, standUp, rounding, facilityOptions, census, releasedModules] = await Promise.allSettled([
    fetchAdminDashboardSnapshot(args.facilityId, supabase),
    fetchPresenceCensus(supabase, args.organizationId, args.facilityId),
    loadStandUpCensus(supabase, args.facilityId),
    loadRounding(supabase, args.facilityId, feed.localDate),
    loadFacilityOptions(supabase),
    fetchHomeCensus(supabase, args.facilityId, args.now),
    loadReleasedModules(supabase, args.facilityId),
  ]);
  const released = releasedModules.status === "fulfilled" ? releasedModules.value : [];
  const [pastDue, notesOnTap] = await Promise.all([
    released.includes("past_due")
      ? fetchHomePastDue(supabase as unknown as SupabaseClient, args.facilityId).catch(() => null)
      : Promise.resolve(null),
    released.includes("quick_note")
      ? fetchNotesOnTap(supabase as unknown as SupabaseClient, args.facilityId).catch(() => [] as HomeNoteOnTap[])
      : Promise.resolve([] as HomeNoteOnTap[]),
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
    releasedModules: released,
    pastDue,
    notesOnTap,
  };
}
