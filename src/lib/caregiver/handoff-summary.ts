/**
 * Shift handoff auto summary (spec 07A §6.3: "shift_handoffs.auto_summary
 * builder includes every care_events row from the outgoing shift grouped by
 * level, so Level 1 notes reach the next shift without anyone re-typing them").
 *
 * `buildShiftHandoffAutoSummary` is pure and returns the `auto_summary` jsonb
 * shape plus printable lines. `loadOutgoingShiftCareEvents` reads the rows for
 * one shift window. `recordShiftHandoff` is the writer: it loads, builds and
 * inserts one `shift_handoffs` row. Level words only ever come from
 * formatLevelWord.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";

import { careEventTileWord } from "@/lib/care-events/tiles";
import { isCareEventKind } from "@/lib/care-events/level-engine";
import { formatLevelWord, levelNumberFromSeverity } from "@/lib/incidents/incidents-display-copy";
import type { Database, Json } from "@/types/database";

import { zonedYmd } from "./emar-queue";
import type { ShiftType } from "./shift";

/** The three floor shifts a handoff can summarize; the enum's `custom` value has no fixed window. */
export type HandoffShift = Extract<ShiftType, "day" | "evening" | "night">;

export type HandoffCareEventInput = {
  id: string;
  kind: string;
  final_level: Database["public"]["Enums"]["incident_severity"] | string;
  occurred_at: string;
  sentence: string;
  resident: { first_name: string | null; last_name: string | null } | null;
  room: string | null;
};

export type HandoffAutoSummaryEntry = {
  care_event_id: string;
  /** "P. Brownell", or the no-resident copy for building events. */
  resident_initial_last: string;
  room: string | null;
  tile_word: string;
  time_label: string;
  sentence: string;
};

export type HandoffAutoSummaryLevelGroup = {
  level_word: string;
  count: number;
  entries: HandoffAutoSummaryEntry[];
};

export type HandoffCareEventsSummary = {
  total: number;
  shift: HandoffShift;
  date: string;
  by_level: HandoffAutoSummaryLevelGroup[];
  generated_at: string;
};

/** The `shift_handoffs.auto_summary` jsonb shape. */
export type HandoffAutoSummary = {
  care_events: HandoffCareEventsSummary;
  lines: string[];
};

export const HANDOFF_NO_RESIDENT_COPY = "No resident";
export const HANDOFF_NO_EVENTS_COPY = "No events this shift.";
export const HANDOFF_RECORDED_COPY = "Handoff recorded";

/** The shift that takes the floor after `shift`: day to evening, evening to night, night to day. */
export function nextShift(shift: HandoffShift): HandoffShift {
  switch (shift) {
    case "day":
      return "evening";
    case "evening":
      return "night";
    case "night":
      return "day";
  }
}

/** Emergency first: the next shift reads the worst news before the notes. */
const LEVEL_ORDER: ReadonlyArray<1 | 2 | 3 | 4> = [4, 3, 2, 1];

const SHIFT_HOURS: Record<HandoffShift, { start: number; end: number }> = {
  day: { start: 7, end: 15 },
  evening: { start: 15, end: 23 },
  night: { start: 23, end: 7 },
};

function addDays(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid date: ${ymd}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12));
  return next.toISOString().slice(0, 10);
}

/**
 * The shift's wall-clock window in the facility zone as UTC instants. The
 * night window starts at 23:00 on `date` and ends at 07:00 the next day.
 */
export function shiftWindow(shift: HandoffShift, date: string, timeZone: string): { startIso: string; endIso: string } {
  const hours = SHIFT_HOURS[shift];
  const endDate = shift === "night" ? addDays(date, 1) : date;
  const pad = (hour: number) => String(hour).padStart(2, "0");
  return {
    startIso: fromZonedTime(`${date}T${pad(hours.start)}:00:00`, timeZone).toISOString(),
    endIso: fromZonedTime(`${endDate}T${pad(hours.end)}:00:00`, timeZone).toISOString(),
  };
}

/**
 * Which shift is on the floor now and the calendar date its window started
 * on. Between midnight and 07:00 the night shift belongs to the previous day.
 */
export function currentShiftWindowFor(timeZone: string, now: Date = new Date()): { shift: HandoffShift; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(now);
  const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "12", 10);
  const safeHour = Number.isNaN(hour) ? 12 : hour % 24;
  const today = zonedYmd(now, timeZone);
  if (safeHour >= 7 && safeHour < 15) return { shift: "day", date: today };
  if (safeHour >= 15 && safeHour < 23) return { shift: "evening", date: today };
  return { shift: "night", date: safeHour >= 23 ? today : addDays(today, -1) };
}

export function residentInitialLast(resident: HandoffCareEventInput["resident"]): string {
  const first = resident?.first_name?.trim() ?? "";
  const last = resident?.last_name?.trim() ?? "";
  if (!first && !last) return HANDOFF_NO_RESIDENT_COPY;
  if (!first) return last;
  if (!last) return `${first[0]}.`;
  return `${first[0]}. ${last}`;
}

function timeLabel(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "No time posted";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(parsed);
}

function tileWord(kind: string): string {
  return isCareEventKind(kind) ? careEventTileWord(kind) : "Event";
}

/** "Emergency 1: P. Brownell, room 12, Fall at 10:05 PM" */
export function handoffSummaryLine(levelWord: string, position: number, entry: HandoffAutoSummaryEntry): string {
  const who = entry.room ? `${entry.resident_initial_last}, room ${entry.room}` : entry.resident_initial_last;
  return `${levelWord} ${position}: ${who}, ${entry.tile_word} at ${entry.time_label}`;
}

export function buildShiftHandoffAutoSummary(input: {
  careEvents: readonly HandoffCareEventInput[];
  timeZone: string;
  shift: HandoffShift;
  date: string;
  now?: Date;
}): HandoffAutoSummary {
  const { careEvents, timeZone, shift, date } = input;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const sorted = [...careEvents].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

  const byLevel: HandoffAutoSummaryLevelGroup[] = [];
  const lines: string[] = [];
  for (const levelNumber of LEVEL_ORDER) {
    const entries = sorted
      .filter((event) => levelNumberFromSeverity(event.final_level) === levelNumber)
      .map<HandoffAutoSummaryEntry>((event) => ({
        care_event_id: event.id,
        resident_initial_last: residentInitialLast(event.resident),
        room: event.room?.trim() || null,
        tile_word: tileWord(event.kind),
        time_label: timeLabel(event.occurred_at, timeZone),
        sentence: event.sentence,
      }));
    if (entries.length === 0) continue;
    const levelWord = formatLevelWord(levelNumber);
    byLevel.push({ level_word: levelWord, count: entries.length, entries });
    entries.forEach((entry, index) => lines.push(handoffSummaryLine(levelWord, index + 1, entry)));
  }

  return {
    care_events: { total: sorted.length, shift, date, by_level: byLevel, generated_at: generatedAt },
    lines,
  };
}

/** The printable lines from a stored `auto_summary`, or none when it has no care events object. */
export function autoSummaryCareEventLines(summary: unknown): string[] {
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return [];
  const record = summary as Record<string, unknown>;
  if (record.care_events == null || typeof record.care_events !== "object") return [];
  const lines = record.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
}

type ResidentEmbed = { first_name: string | null; last_name: string | null; bed_id: string | null } | null;

/**
 * Every care event for the facility whose `occurred_at` falls in the shift
 * window, with the resident's name and room. Three small reads instead of a
 * nested embed so the beds relationship never needs a foreign-key hint.
 */
export async function loadOutgoingShiftCareEvents(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  timeZone: string,
  shift: HandoffShift,
  date: string,
): Promise<HandoffCareEventInput[]> {
  const window = shiftWindow(shift, date, timeZone);
  const events = await supabase
    .from("care_events")
    .select("id, kind, final_level, occurred_at, sentence, resident:residents(first_name, last_name, bed_id)")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("occurred_at", window.startIso)
    .lt("occurred_at", window.endIso)
    .order("occurred_at", { ascending: true })
    .limit(500);
  if (events.error) throw events.error;

  const rows = events.data ?? [];
  const bedIds = [...new Set(rows.map((row) => (row.resident as ResidentEmbed)?.bed_id).filter((id): id is string => !!id))];
  const roomByBed = new Map<string, string>();
  if (bedIds.length > 0) {
    const beds = await supabase.from("beds").select("id, room_id").in("id", bedIds);
    if (beds.error) throw beds.error;
    const roomIds = [...new Set((beds.data ?? []).map((bed) => bed.room_id).filter((id): id is string => !!id))];
    const roomNumberById = new Map<string, string>();
    if (roomIds.length > 0) {
      const rooms = await supabase.from("rooms").select("id, room_number").in("id", roomIds);
      if (rooms.error) throw rooms.error;
      for (const room of rooms.data ?? []) roomNumberById.set(room.id, room.room_number);
    }
    for (const bed of beds.data ?? []) {
      const number = bed.room_id ? roomNumberById.get(bed.room_id) : undefined;
      if (number) roomByBed.set(bed.id, number);
    }
  }

  return rows.map((row) => {
    const resident = row.resident as ResidentEmbed;
    return {
      id: row.id,
      kind: row.kind,
      final_level: row.final_level,
      occurred_at: row.occurred_at,
      sentence: row.sentence,
      resident: resident ? { first_name: resident.first_name, last_name: resident.last_name } : null,
      room: resident?.bed_id ? (roomByBed.get(resident.bed_id) ?? null) : null,
    };
  });
}

export type RecordShiftHandoffInput = {
  facilityId: string;
  organizationId: string;
  timeZone: string;
  outgoingShift: HandoffShift;
  incomingShift: HandoffShift;
  /** Today in the facility zone (the wall-clock date the caregiver taps Record). */
  handoffDate: string;
  /**
   * The calendar date the outgoing shift's window started on (facility zone).
   * Differs from `handoffDate` only for a night shift recorded after midnight.
   * Defaults to `handoffDate`. The stored `handoff_date` is this window date,
   * so one row keys one shift window and consecutive nights never collide.
   */
  shiftDate?: string;
  outgoingStaffId: string;
  outgoingNotes?: string | null;
  now?: Date;
};

/** The `shift_handoffs` row the writer inserts, before the database fills defaults. */
export type ShiftHandoffInsert = {
  facility_id: string;
  organization_id: string;
  handoff_date: string;
  outgoing_shift: HandoffShift;
  incoming_shift: HandoffShift;
  outgoing_staff_id: string;
  outgoing_notes: string | null;
  auto_summary: HandoffAutoSummary;
};

/** Pure: the row for one handoff from the outgoing shift's care events. */
export function buildShiftHandoffInsert(
  input: RecordShiftHandoffInput,
  careEvents: readonly HandoffCareEventInput[],
): ShiftHandoffInsert {
  const note = input.outgoingNotes?.trim() ?? "";
  return {
    facility_id: input.facilityId,
    organization_id: input.organizationId,
    handoff_date: input.shiftDate ?? input.handoffDate,
    outgoing_shift: input.outgoingShift,
    incoming_shift: input.incomingShift,
    outgoing_staff_id: input.outgoingStaffId,
    outgoing_notes: note.length > 0 ? note : null,
    auto_summary: buildShiftHandoffAutoSummary({
      careEvents,
      timeZone: input.timeZone,
      shift: input.outgoingShift,
      date: input.shiftDate ?? input.handoffDate,
      now: input.now,
    }),
  };
}

/**
 * Record the outgoing shift's handoff: every care event in the shift window
 * grouped by level word lands in `shift_handoffs.auto_summary`, so Level 1
 * notes reach the next shift without anyone re-typing them (spec 07A §6.3).
 * Inserts directly: the `staff_create_shift_handoffs` policy (019) admits
 * owner, org_admin, facility_admin, med_tech (468) and caregiver within their
 * accessible facilities. Returns the new row id and the summary written.
 */
export async function recordShiftHandoff(
  supabase: SupabaseClient<Database>,
  input: RecordShiftHandoffInput,
): Promise<{ id: string; summary: HandoffAutoSummary }> {
  const careEvents = await loadOutgoingShiftCareEvents(
    supabase,
    input.facilityId,
    input.timeZone,
    input.outgoingShift,
    input.shiftDate ?? input.handoffDate,
  );
  const row = buildShiftHandoffInsert(input, careEvents);
  const summary = row.auto_summary as unknown as Json;

  // One handoff per facility, date, and outgoing shift: a second tap refreshes
  // the same record instead of filing a duplicate the incoming shift must untangle.
  const existing = await supabase
    .from("shift_handoffs")
    .select("id")
    .eq("facility_id", row.facility_id)
    .eq("handoff_date", row.handoff_date)
    .eq("outgoing_shift", row.outgoing_shift)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const updated = await supabase
      .from("shift_handoffs")
      .update({ auto_summary: summary, outgoing_notes: row.outgoing_notes, updated_at: new Date().toISOString() })
      .eq("id", existing.data.id)
      .select("id")
      .single();
    if (updated.error) throw updated.error;
    return { id: updated.data.id, summary: row.auto_summary };
  }

  const inserted = await supabase
    .from("shift_handoffs")
    .insert({ ...row, auto_summary: summary })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return { id: inserted.data.id, summary: row.auto_summary };
}
