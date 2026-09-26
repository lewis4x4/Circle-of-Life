/**
 * The floor tablet's resident screen (spec 40 §6 screen 4, DESIGN.md 04):
 * header, recent checks (the last 24 hours, not just since midnight), watch
 * and follow-ups with the last handoff note and anyone visiting now, and
 * "Know before you go in",
 * which carries the same instruction fields the caregiver resident hub reads
 * from the resident record. Nothing about medicines is read here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { enumLabel } from "@/lib/display/enum-label";
import { FLOOR_CHECK_NAME, checkTiming, type FloorTaskApiRow } from "@/lib/floor/now-rows";
import { formatDisplayTime } from "@/lib/format/datetime";
import { CODE_STATUS_OPTIONS } from "@/lib/residents/resident-record-edit";
import { liveBoardRungLabel } from "@/lib/rounding/live-board-display-copy";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** `missing`: a safety field nobody has filled in yet, shown so it is never read as "none". */
export type InfoItem = { key: string; title: string; detail: string | null; tone?: "missing" };

export type ResidentRecordFields = {
  gender: string | null;
  status: string;
  fall_risk_level: string | null;
  elopement_risk: boolean;
  wandering_risk: boolean;
  assistive_device: string | null;
  special_instructions: string | null;
  allergy_list: string[] | null;
  /** Set when someone confirmed the allergy list, including an empty one (no known allergies). */
  allergy_list_reviewed_at?: string | null;
  diet_order: string | null;
  code_status: string | null;
};

export type ResidentDetail = {
  record: ResidentRecordFields;
  watches: { id: string; label: string; startsAt: string; endsAt: string | null }[];
  escalations: { id: string; label: string; triggeredAt: string }[];
  /** Checks charted in the last 24 hours, oldest first. */
  logsToday: { taskId: string; observedAt: string; summary: string; staffName: string | null }[];
  /** The newest shift handoff note about this resident from the last 7 days. */
  lastHandoff: { id: string; note: string; createdAt: string; shift: string; authorName: string | null } | null;
  /** Visitors signed in for this resident and not yet signed out. */
  visitorsHere: { id: string; name: string; type: string; since: string }[];
};

/** Short visitor name for the floor ("Carol P."), the way the kiosk shows it. */
export function floorVisitorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const last = parts[parts.length - 1]!;
  return `${parts.slice(0, -1).join(" ")} ${last.charAt(0).toUpperCase()}.`;
}

const VISITOR_TYPE_WORD: Record<string, string> = {
  family_friend: "family or friend",
  healthcare_provider: "healthcare provider",
  vendor_contractor: "vendor",
  surveyor_regulator: "inspector",
};

export function floorVisitorTypeWord(type: string): string {
  return VISITOR_TYPE_WORD[type] ?? "visitor";
}

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

const NOT_RECORDED_NOTE = "Ask the nurse or administrator before care that depends on it.";

/**
 * Safety fields nobody has filled in yet (COL-865). A blank allergy list, diet,
 * fall risk, assistive device or code status is unknown, not "none": each one
 * says so, first, before anything the record does carry.
 */
export function notRecordedItems(record: ResidentRecordFields): InfoItem[] {
  const items: InfoItem[] = [];
  const allergies = (record.allergy_list ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (allergies.length === 0 && !record.allergy_list_reviewed_at) {
    items.push({ key: "missing-allergies", title: "Allergies not recorded", detail: NOT_RECORDED_NOTE, tone: "missing" });
  }
  if (!record.diet_order?.trim()) items.push({ key: "missing-diet", title: "Diet order not recorded", detail: NOT_RECORDED_NOTE, tone: "missing" });
  if (!record.fall_risk_level) items.push({ key: "missing-fall", title: "Fall risk not assessed", detail: NOT_RECORDED_NOTE, tone: "missing" });
  if (!record.assistive_device?.trim()) {
    items.push({ key: "missing-device", title: "Assistive device not recorded", detail: "Walker, wheelchair, cane, or none.", tone: "missing" });
  }
  if (!record.code_status) items.push({ key: "missing-code", title: "Code status not recorded", detail: NOT_RECORDED_NOTE, tone: "missing" });
  return items;
}

/** "DNR", "DNI", "DNR/DNI", "Comfort care only": the record editor's short labels, never "Dnr". */
export function floorCodeStatusLabel(value: string): string {
  const option = CODE_STATUS_OPTIONS.find((entry) => entry.value === value);
  return option ? option.label.split(" — ")[0]!.trim() : enumLabel(value);
}

/** Instruction fields, the value as the line and the field as its note; what is not recorded comes first. */
export function knowBeforeItems(record: ResidentRecordFields): InfoItem[] {
  const items: InfoItem[] = notRecordedItems(record);
  if (record.fall_risk_level === "high" || record.fall_risk_level === "moderate") {
    items.push({ key: "fall", title: record.fall_risk_level === "high" ? "High fall risk" : "Moderate fall risk", detail: null });
  }
  if (record.elopement_risk) items.push({ key: "elopement", title: "Elopement risk", detail: null });
  if (record.wandering_risk) items.push({ key: "wandering", title: "Wandering risk", detail: null });
  const device = record.assistive_device?.trim();
  if (device && device.toLowerCase() !== "none") items.push({ key: "device", title: device, detail: "Assistive device" });
  const instructions = record.special_instructions?.trim();
  if (instructions) items.push({ key: "instructions", title: instructions, detail: "Special instructions" });
  const allergies = (record.allergy_list ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (allergies.length > 0) items.push({ key: "allergies", title: allergies.join(", "), detail: "Allergies" });
  else if (record.allergy_list_reviewed_at) items.push({ key: "allergies", title: "No known allergies", detail: "Allergies, reviewed" });
  const diet = record.diet_order?.trim();
  if (diet && diet.toLowerCase() !== "regular") items.push({ key: "diet", title: diet, detail: "Diet order" });
  if (record.code_status && record.code_status !== "full_code") {
    items.push({ key: "code", title: floorCodeStatusLabel(record.code_status), detail: "Code status" });
  }
  return items;
}

export async function fetchResidentDetail(
  supabase: Client,
  input: { residentId: string; facilityId: string; sinceIso: string; now?: Date },
): Promise<ResidentDetail | null> {
  const now = input.now ?? new Date();
  const handoffSince = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const [resident, watches, escalations, logs, handoff, visitors] = await Promise.all([
    supabase
      .from("residents" as never)
      .select(
        "gender, status, fall_risk_level, elopement_risk, wandering_risk, assistive_device, special_instructions, allergy_list, allergy_list_reviewed_at, diet_order, code_status",
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
    supabase
      .from("shift_handoff_notes" as never)
      .select("id, note, created_at, shift, created_by, schedule_preset_name")
      .eq("resident_id", input.residentId)
      .eq("facility_id", input.facilityId)
      .gte("created_at", handoffSince)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("visitor_log_entries" as never)
      .select("id, visitor_name, visitor_type, checked_in_at")
      .eq("resident_id", input.residentId)
      .eq("facility_id", input.facilityId)
      .is("checked_out_at", null)
      .is("voided_at", null)
      .is("deleted_at", null)
      .gte("checked_in_at", new Date(now.getTime() - 24 * 60 * 60_000).toISOString())
      .order("checked_in_at", { ascending: true }),
  ]);
  if (resident.error) throw resident.error;
  if (!resident.data) return null;
  if (watches.error) throw watches.error;
  if (escalations.error) throw escalations.error;
  if (logs.error) throw logs.error;
  // The handoff note and visitors are context: a failed read leaves them out, never the screen.
  const handoffRow = handoff.error ? null : ((handoff.data ?? []) as unknown as { id: string; note: string; created_at: string; shift: string; created_by: string | null; schedule_preset_name: string | null }[])[0] ?? null;
  const visitorRows = visitors.error ? [] : ((visitors.data ?? []) as unknown as { id: string; visitor_name: string; visitor_type: string; checked_in_at: string }[]);
  let handoffAuthor: string | null = null;
  if (handoffRow?.created_by) {
    const profile = await supabase.from("user_profiles").select("full_name").eq("id", handoffRow.created_by).maybeSingle();
    handoffAuthor = profile.data?.full_name ? floorVisitorName(profile.data.full_name) : null;
  }

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
    lastHandoff: handoffRow
      ? { id: handoffRow.id, note: handoffRow.note, createdAt: handoffRow.created_at, shift: handoffRow.schedule_preset_name?.trim() || enumLabel(handoffRow.shift), authorName: handoffAuthor }
      : null,
    visitorsHere: visitorRows.map((row) => ({ id: row.id, name: floorVisitorName(row.visitor_name), type: row.visitor_type, since: row.checked_in_at })),
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
          ? `Not charted · ${timing.minutes} ${timing.minutes === 1 ? "minute" : "minutes"} over`
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

/** Charted checks the recent card lists at most. */
export const RECENT_CHECKS_SHOWN = 8;

/**
 * "Recent checks": what still needs doing (anything over or due, then the next
 * one coming), then the last 24 hours of charted checks newest first, each with
 * what was charted and by whom. A check charted before today says "Yesterday",
 * so the night shift sees the evening's checks instead of an empty card at midnight.
 */
export function recentCheckItems(input: {
  tasks: readonly FloorTaskApiRow[];
  logs: ResidentDetail["logsToday"];
  dayStartIso: string;
  now: Date;
  timeZone: string;
}): InfoItem[] {
  const charted = new Set(input.logs.map((log) => log.taskId));
  const open = input.tasks
    .filter((task) => !charted.has(task.id))
    .map((task) => ({ task, timing: checkTiming(task.derived_status, task.due_at, input.now) }))
    .filter(({ timing }) => timing.kind === "over" || timing.kind === "due" || timing.kind === "upcoming")
    .sort((a, b) => a.task.due_at.localeCompare(b.task.due_at));
  const pending = [...open.filter(({ timing }) => timing.kind !== "upcoming"), ...open.filter(({ timing }) => timing.kind === "upcoming").slice(0, 1)];
  const openItems: InfoItem[] = pending.map(({ task, timing }) => ({
    key: task.id,
    title: `${formatDisplayTime(task.due_at, { timeZone: input.timeZone })} · ${FLOOR_CHECK_NAME}`,
    detail:
      timing.kind === "over"
        ? `Not charted · ${timing.minutes} ${timing.minutes === 1 ? "minute" : "minutes"} over`
        : timing.kind === "due"
          ? "Due now"
          : "Next check",
  }));
  const chartedItems: InfoItem[] = [...input.logs]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, RECENT_CHECKS_SHOWN)
    .map((log) => ({
      key: `log-${log.taskId}-${log.observedAt}`,
      title: `${log.observedAt < input.dayStartIso ? "Yesterday " : ""}${formatDisplayTime(log.observedAt, { timeZone: input.timeZone })} · ${log.summary}`,
      detail: `${FLOOR_CHECK_NAME} · ${log.staffName ?? "Staff"}`,
    }));
  return [...openItems, ...chartedItems];
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
