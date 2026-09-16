/**
 * The Today strip on `/admin/incidents` (spec 07A §6.3 and §7 Tier 1):
 * acknowledgment queue, open AHCA clocks, events today by level word.
 * Windows come from care_event_escalation_policies, never a constant here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatLevelWord, levelNumberFromSeverity, type IncidentLevelNumber } from "@/lib/incidents/incidents-display-copy";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

const DEFAULT_TIME_ZONE = "America/New_York";
const AHCA_WARNING_HOURS = 24;

export type AckPolicyRow = {
  facility_id: string | null;
  level: string;
  step: number;
  ack_within_minutes: number | null;
};

export type OpenCareEventLite = {
  id: string;
  final_level: string;
  status: string;
  created_at: string;
};

export type AckQueue = {
  count: number;
  /** Age of the oldest unacknowledged event past its window, in minutes. */
  oldestMinutes: number | null;
  /** True when a level had no policy row, so its events could not be judged. */
  windowUnknown: boolean;
};

export type AhcaClocks = {
  count: number;
  /** Hours until the soonest deadline; negative when past due. */
  soonestHours: number | null;
  tone: "neutral" | "warning" | "destructive";
};

export type LevelCounts = Record<IncidentLevelNumber, number>;

export type TodayStripData = {
  ackQueue: AckQueue;
  ahcaClocks: AhcaClocks;
  levelCounts: LevelCounts;
};

/**
 * Step 0's ack_within_minutes for the level: facility rows for the level win
 * as a set when any exist, otherwise the organization rows (facility_id null).
 */
export function ackWindowMinutes(level: IncidentLevelNumber, facilityId: string, policies: readonly AckPolicyRow[]): number | null {
  const forLevel = policies.filter((row) => levelNumberFromSeverity(row.level) === level);
  const facilityRows = forLevel.filter((row) => row.facility_id === facilityId);
  const set = facilityRows.length > 0 ? facilityRows : forLevel.filter((row) => row.facility_id === null);
  const stepZero = set.find((row) => row.step === 0);
  return stepZero?.ack_within_minutes ?? null;
}

export function buildAckQueue(
  events: readonly OpenCareEventLite[],
  policies: readonly AckPolicyRow[],
  facilityId: string,
  nowMs: number,
): AckQueue {
  let count = 0;
  let oldestMinutes: number | null = null;
  let windowUnknown = false;
  for (const event of events) {
    if (event.status !== "open") continue;
    const level = levelNumberFromSeverity(event.final_level);
    if (!level || level < 2) continue;
    const window = ackWindowMinutes(level, facilityId, policies);
    if (window === null) {
      windowUnknown = true;
      continue;
    }
    const ageMinutes = Math.floor((nowMs - new Date(event.created_at).getTime()) / 60_000);
    if (Number.isNaN(ageMinutes) || ageMinutes <= window) continue;
    count += 1;
    if (oldestMinutes === null || ageMinutes > oldestMinutes) oldestMinutes = ageMinutes;
  }
  return { count, oldestMinutes, windowUnknown };
}

export function buildAhcaClocks(obligations: readonly { due_at: string; submitted_at: string | null }[], nowMs: number): AhcaClocks {
  let soonestHours: number | null = null;
  let count = 0;
  for (const row of obligations) {
    if (row.submitted_at) continue;
    const due = new Date(row.due_at).getTime();
    if (Number.isNaN(due)) continue;
    count += 1;
    const hours = (due - nowMs) / 3_600_000;
    if (soonestHours === null || hours < soonestHours) soonestHours = hours;
  }
  const tone: AhcaClocks["tone"] =
    soonestHours === null ? "neutral" : soonestHours < 0 ? "destructive" : soonestHours < AHCA_WARNING_HOURS ? "warning" : "neutral";
  return { count, soonestHours, tone };
}

export function countEventsByLevel(events: readonly { final_level: string }[]): LevelCounts {
  const counts: LevelCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const event of events) {
    const level = levelNumberFromSeverity(event.final_level);
    if (level) counts[level] += 1;
  }
  return counts;
}

/** "Note 3, Heads-up 1, Urgent 0, Emergency 0". */
export function levelCountLine(counts: LevelCounts): string {
  return ([1, 2, 3, 4] as const).map((level) => `${formatLevelWord(level)} ${counts[level]}`).join(", ");
}

/** "Oldest 42 min" for the queue tile, or the plain empty line. */
export function ackQueueLine(queue: AckQueue): string {
  if (queue.count === 0) return queue.windowUnknown ? "No acknowledgment window is configured" : "Nothing waiting";
  return queue.oldestMinutes === null ? "Waiting" : `Oldest ${queue.oldestMinutes} min`;
}

/** "Soonest in 5 h", "Past due by 3 h", or the plain empty line. */
export function ahcaClockLine(clocks: AhcaClocks): string {
  if (clocks.count === 0 || clocks.soonestHours === null) return "No open clocks";
  const hours = Math.abs(clocks.soonestHours);
  const rounded = hours < 1 ? Math.max(1, Math.ceil(hours * 60)) : Math.ceil(hours);
  const unit = hours < 1 ? "min" : "h";
  return clocks.soonestHours < 0 ? `Past due by ${rounded} ${unit}` : `Soonest in ${rounded} ${unit}`;
}

/** The UTC instant of local midnight today in the facility timezone. */
export function startOfTodayIso(nowMs: number, timeZone: string): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  const local = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
  return new Date(guess - (local - guess)).toISOString();
}

export async function loadTodayStrip(supabase: Client, facilityId: string, nowMs: number = Date.now()): Promise<TodayStripData> {
  const facility = await supabase.from("facilities").select("id, timezone").eq("id", facilityId).maybeSingle();
  if (facility.error) throw facility.error;
  const timeZone = facility.data?.timezone || DEFAULT_TIME_ZONE;
  const since = startOfTodayIso(nowMs, timeZone);

  const [open, today, policies, obligations] = await Promise.all([
    supabase
      .from("care_events")
      .select("id, final_level, status, created_at")
      .eq("facility_id", facilityId)
      .eq("status", "open")
      .in("final_level", ["level_2", "level_3", "level_4"])
      .is("deleted_at", null),
    supabase
      .from("care_events")
      .select("id, final_level")
      .eq("facility_id", facilityId)
      .gte("created_at", since)
      .is("deleted_at", null),
    supabase
      .from("care_event_escalation_policies")
      .select("facility_id, level, step, ack_within_minutes")
      .eq("is_active", true)
      .or(`facility_id.eq.${facilityId},facility_id.is.null`),
    supabase
      .from("regulatory_reporting_obligations")
      .select("due_at, submitted_at")
      .eq("facility_id", facilityId)
      .is("submitted_at", null)
      .is("deleted_at", null),
  ]);
  if (open.error) throw open.error;
  if (today.error) throw today.error;
  if (policies.error) throw policies.error;
  if (obligations.error) throw obligations.error;

  return {
    ackQueue: buildAckQueue(open.data ?? [], policies.data ?? [], facilityId, nowMs),
    ahcaClocks: buildAhcaClocks(obligations.data ?? [], nowMs),
    levelCounts: countEventsByLevel(today.data ?? []),
  };
}
