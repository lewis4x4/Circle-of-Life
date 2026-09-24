/**
 * The Now screen's "My shift" strip (spec 40 §6 screen 3): what the signed-in
 * person has done since the shift in force began. Every chip is a record that
 * exists: the front-door punch, checks they charted, reports they filed,
 * handoff notes they read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { careEventTileWord } from "@/lib/care-events/tiles";
import { isCareEventKind } from "@/lib/care-events/level-engine";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** `href` opens the record behind the chip (a report's receipt). */
export type ShiftStripItem = { key: string; at: string | null; text: string; href?: string };

export type ShiftActivity = {
  roundsCharted: number;
  lastRoundAt: string | null;
  reports: { id: string; at: string; kind: string; residentId: string | null }[];
  handoffNotesRead: number;
  lastHandoffReadAt: string | null;
};

export function buildShiftStripItems(input: {
  clockedInAt: string | null;
  activity: ShiftActivity;
  /** My assigned checks due so far this shift and how many are charted, when I have any. */
  roundsAssigned: { charted: number; due: number } | null;
  roomByResident: ReadonlyMap<string, string | null>;
}): ShiftStripItem[] {
  const items: ShiftStripItem[] = [];
  if (input.clockedInAt) items.push({ key: "clock-in", at: input.clockedInAt, text: "Clocked in at the front door" });
  const { activity } = input;
  if (activity.roundsCharted > 0 || input.roundsAssigned) {
    // With an assignment the chip reads against it; without one it counts every check I charted.
    const text = input.roundsAssigned
      ? `Rounds: ${input.roundsAssigned.charted} of ${input.roundsAssigned.due} charted`
      : `Rounds: ${activity.roundsCharted} charted`;
    items.push({ key: "rounds", at: activity.lastRoundAt, text });
  }
  if (activity.handoffNotesRead > 0) {
    items.push({
      key: "handoff-read",
      at: activity.lastHandoffReadAt,
      text: activity.handoffNotesRead === 1 ? "Handoff note read" : `${activity.handoffNotesRead} handoff notes read`,
    });
  }
  for (const report of activity.reports) {
    const word = isCareEventKind(report.kind) ? careEventTileWord(report.kind) : "Something happened";
    const room = report.residentId ? input.roomByResident.get(report.residentId) : null;
    items.push({
      key: `report-${report.id}`,
      at: report.at,
      text: room ? `Report: ${word}, Rm ${room}` : `Report: ${word}`,
      href: `/floor/report/${report.id}`,
    });
  }
  return items.sort((a, b) => (a.at ?? "~").localeCompare(b.at ?? "~"));
}

export async function fetchShiftActivity(
  supabase: Client,
  input: { userId: string; staffIds: readonly string[]; facilityId: string; sinceIso: string },
): Promise<ShiftActivity> {
  const [rounds, reports, handoff] = await Promise.all([
    input.staffIds.length > 0
      ? supabase
          .from("resident_observation_logs")
          .select("observed_at")
          .eq("facility_id", input.facilityId)
          .in("staff_id", input.staffIds as string[])
          .gte("observed_at", input.sinceIso)
          .is("deleted_at", null)
          .order("observed_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as { observed_at: string }[], error: null }),
    supabase
      .from("care_events")
      .select("id, created_at, kind, resident_id")
      .eq("facility_id", input.facilityId)
      .eq("reported_by", input.userId)
      .gte("created_at", input.sinceIso)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("shift_handoff_notes" as never)
      .select("acknowledged_at")
      .eq("facility_id", input.facilityId)
      .eq("acknowledged_by", input.userId)
      .gte("acknowledged_at", input.sinceIso)
      .is("deleted_at", null)
      .order("acknowledged_at", { ascending: false })
      .limit(100),
  ]);
  if (rounds.error) throw rounds.error;
  if (reports.error) throw reports.error;
  if (handoff.error) throw handoff.error;
  const roundRows = (rounds.data ?? []) as { observed_at: string }[];
  const handoffRows = (handoff.data ?? []) as unknown as { acknowledged_at: string | null }[];
  return {
    roundsCharted: roundRows.length,
    lastRoundAt: roundRows[0]?.observed_at ?? null,
    reports: (reports.data ?? []).map((row) => ({ id: row.id, at: row.created_at, kind: row.kind, residentId: row.resident_id })),
    handoffNotesRead: handoffRows.length,
    lastHandoffReadAt: handoffRows[0]?.acknowledged_at ?? null,
  };
}
