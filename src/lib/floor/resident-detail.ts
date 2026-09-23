/**
 * The floor tablet's resident screen (spec 40 §6 screen 4, DESIGN.md 04):
 * header, today's checks, watch and follow-ups, and "Know before you go in",
 * which carries the same instruction fields the caregiver resident hub reads
 * from the resident record. Nothing about medicines is read here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { enumLabel } from "@/lib/display/enum-label";
import { FLOOR_CHECK_NAME, checkTiming, type FloorTaskApiRow } from "@/lib/floor/now-rows";
import { formatDisplayTime } from "@/lib/format/datetime";
import { liveBoardRungLabel } from "@/lib/rounding/live-board-display-copy";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type InfoItem = { key: string; title: string; detail: string | null };

export type ResidentRecordFields = {
  gender: string | null;
  status: string;
  fall_risk_level: string | null;
  elopement_risk: boolean;
  wandering_risk: boolean;
  assistive_device: string | null;
  special_instructions: string | null;
  allergy_list: string[] | null;
  diet_order: string | null;
  code_status: string | null;
};

export type ResidentDetail = {
  record: ResidentRecordFields;
  watches: { id: string; label: string; startsAt: string; endsAt: string | null }[];
  escalations: { id: string; label: string; triggeredAt: string }[];
  logsToday: { taskId: string; observedAt: string; summary: string; staffName: string | null }[];
};

/**
 * "Ashley W." for the staff ids given, through `floor_staff_display_names`:
 * a direct `staff` read only returns the viewer's own row under RLS, so
 * another person's charted check would show no name. Ids it does not name are
 * left out; callers show neutral copy.
 */
export async function fetchStaffDisplayNames(supabase: Client, staffIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(staffIds)].filter(Boolean);
  const names = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.rpc("floor_staff_display_names", { p_staff_ids: ids.slice(start, start + 200) });
    // A name is a courtesy on this screen; the check itself still shows.
    if (error) continue;
    for (const row of data ?? []) if (row.display_name) names.set(row.staff_id, row.display_name);
  }
  return names;
}

/** Instruction fields, the value as the line and the field as its note. */
export function knowBeforeItems(record: ResidentRecordFields): InfoItem[] {
  const items: InfoItem[] = [];
  if (record.fall_risk_level === "high" || record.fall_risk_level === "moderate") {
    items.push({ key: "fall", title: record.fall_risk_level === "high" ? "High fall risk" : "Moderate fall risk", detail: null });
  }
  if (record.elopement_risk) items.push({ key: "elopement", title: "Elopement risk", detail: null });
  if (record.wandering_risk) items.push({ key: "wandering", title: "Wandering risk", detail: null });
  const device = record.assistive_device?.trim();
  if (device) items.push({ key: "device", title: device, detail: "Assistive device" });
  const instructions = record.special_instructions?.trim();
  if (instructions) items.push({ key: "instructions", title: instructions, detail: "Special instructions" });
  const allergies = (record.allergy_list ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (allergies.length > 0) items.push({ key: "allergies", title: allergies.join(", "), detail: "Allergies" });
  const diet = record.diet_order?.trim();
  if (diet && diet.toLowerCase() !== "regular") items.push({ key: "diet", title: diet, detail: "Diet order" });
  if (record.code_status && record.code_status !== "full_code") {
    items.push({ key: "code", title: enumLabel(record.code_status), detail: "Code status" });
  }
  return items;
}

export async function fetchResidentDetail(
  supabase: Client,
  input: { residentId: string; facilityId: string; sinceIso: string; now?: Date },
): Promise<ResidentDetail | null> {
  const now = input.now ?? new Date();
  const [resident, watches, escalations, logs] = await Promise.all([
    supabase
      .from("residents" as never)
      .select(
        "gender, status, fall_risk_level, elopement_risk, wandering_risk, assistive_device, special_instructions, allergy_list, diet_order, code_status",
      )
      .eq("id", input.residentId)
      .eq("facility_id", input.facilityId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("resident_watch_instances")
      .select("id, starts_at, ends_at, protocol_id")
      .eq("resident_id", input.residentId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("starts_at", { ascending: false }),
    supabase
      .from("resident_observation_escalations")
      .select("id, rung_key, triggered_at")
      .eq("resident_id", input.residentId)
      .in("status", ["open", "in_progress"])
      .is("deleted_at", null)
      .order("triggered_at", { ascending: false })
      .limit(10),
    supabase
      .from("resident_observation_logs")
      .select("task_id, observed_at, composed_summary, staff_id")
      .eq("resident_id", input.residentId)
      .gte("observed_at", input.sinceIso)
      .is("deleted_at", null)
      .order("observed_at", { ascending: true })
      .limit(50),
  ]);
  if (resident.error) throw resident.error;
  if (!resident.data) return null;
  if (watches.error) throw watches.error;
  if (escalations.error) throw escalations.error;
  if (logs.error) throw logs.error;

  const liveWatches = (watches.data ?? []).filter((row) => !row.ends_at || new Date(row.ends_at).getTime() > now.getTime());
  const protocolIds = [...new Set(liveWatches.map((row) => row.protocol_id).filter((id): id is string => Boolean(id)))];
  const staffIds = [...new Set((logs.data ?? []).map((row) => row.staff_id))];
  const [protocols, staffNames] = await Promise.all([
    protocolIds.length > 0
      ? supabase.from("resident_watch_protocols").select("id, name").in("id", protocolIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    fetchStaffDisplayNames(supabase, staffIds),
  ]);
  const protocolNames = new Map((protocols.data ?? []).map((row) => [row.id, row.name] as const));

  return {
    record: resident.data as unknown as ResidentRecordFields,
    watches: liveWatches.map((row) => ({
      id: row.id,
      label: (row.protocol_id ? protocolNames.get(row.protocol_id)?.trim() : null) || "Watch",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    })),
    escalations: (escalations.data ?? []).map((row) => ({ id: row.id, label: liveBoardRungLabel(row.rung_key), triggeredAt: row.triggered_at })),
    logsToday: (logs.data ?? []).map((row) => ({
      taskId: row.task_id,
      observedAt: row.observed_at,
      summary: row.composed_summary,
      staffName: staffNames.get(row.staff_id) ?? null,
    })),
  };
}

/** "9:30", the way the resident screen's chart button reads it. */
export function clockWithoutDayHalf(iso: string, timeZone: string): string {
  return formatDisplayTime(iso, { timeZone }).replace(/\s?[AP]M$/i, "");
}

/**
 * "Today's checks": each of today's checks for this resident, charted ones
 * with what was charted and by whom, open ones with where they stand.
 */
export function todayCheckItems(input: {
  tasks: readonly FloorTaskApiRow[];
  logs: ResidentDetail["logsToday"];
  dayStartIso: string;
  now: Date;
  timeZone: string;
}): InfoItem[] {
  const dayEndMs = new Date(input.dayStartIso).getTime() + 24 * 60 * 60_000;
  const logByTask = new Map(input.logs.map((log) => [log.taskId, log] as const));
  return input.tasks
    .filter((task) => task.due_at >= input.dayStartIso && new Date(task.due_at).getTime() < dayEndMs)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .map((task) => {
      const log = logByTask.get(task.id);
      if (log) {
        return {
          key: task.id,
          title: `${formatDisplayTime(log.observedAt, { timeZone: input.timeZone })} · ${log.summary}`,
          // Someone the display-name lookup would not name still charted it: say so neutrally.
          detail: `${FLOOR_CHECK_NAME} · ${log.staffName ?? "Staff"}`,
        };
      }
      const timing = checkTiming(task.derived_status, task.due_at, input.now);
      const detail =
        timing.kind === "over"
          ? `Not charted · ${timing.minutes} minutes over`
          : timing.kind === "due"
            ? "Due now"
            : timing.kind === "done"
              ? "Charted"
              : timing.kind === "excused"
                ? "Excused"
                : "Upcoming";
      return { key: task.id, title: `${formatDisplayTime(task.due_at, { timeZone: input.timeZone })} · ${FLOOR_CHECK_NAME}`, detail };
    });
}

/** The next check to chart: the oldest one still open. */
export function nextOpenCheck(tasks: readonly FloorTaskApiRow[], now: Date): FloorTaskApiRow | null {
  const open = tasks
    .filter((task) => {
      const kind = checkTiming(task.derived_status, task.due_at, now).kind;
      return kind === "over" || kind === "due" || kind === "upcoming";
    })
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  return open[0] ?? null;
}
