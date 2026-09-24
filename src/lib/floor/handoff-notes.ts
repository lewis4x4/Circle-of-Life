/**
 * The floor tablet's Handoff tab reads and writes the same shared shift notes
 * as the caregiver handoff board (`ShiftHandoffBoard`, `shift_handoff_notes`),
 * with the same writes: acknowledge, and post under the shift in force.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { currentShiftFor } from "@/lib/caregiver/shift";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type HandoffNote = {
  id: string;
  note: string;
  priority: string;
  createdAt: string;
  shift: string;
  acknowledgedAt: string | null;
  createdBy: string | null;
  authorName: string | null;
  residentId: string | null;
};

type NoteRow = {
  id: string;
  note: string;
  priority: string;
  created_at: string;
  shift: string;
  acknowledged_at: string | null;
  created_by: string | null;
  resident_id: string | null;
};

export async function fetchHandoffNotes(supabase: Client, facilityId: string): Promise<HandoffNote[]> {
  const result = await supabase
    .from("shift_handoff_notes" as never)
    .select("id, note, priority, created_at, shift, acknowledged_at, created_by, resident_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as unknown as NoteRow[];
  const authorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const profiles = await supabase.from("user_profiles").select("id, full_name").in("id", authorIds);
    // A missing author name only costs the byline.
    for (const row of profiles.data ?? []) names.set(row.id, row.full_name);
  }
  return rows.map((row) => ({
    id: row.id,
    note: row.note,
    priority: row.priority,
    createdAt: row.created_at,
    shift: row.shift,
    acknowledgedAt: row.acknowledged_at,
    createdBy: row.created_by,
    authorName: row.created_by ? (names.get(row.created_by) ?? null) : null,
    residentId: row.resident_id,
  }));
}

export async function acknowledgeHandoffNote(supabase: Client, input: { noteId: string; userId: string }): Promise<void> {
  const result = await supabase
    .from("shift_handoff_notes" as never)
    .update({ acknowledged_by: input.userId, acknowledged_at: new Date().toISOString(), updated_by: input.userId } as never)
    .eq("id", input.noteId)
    .is("acknowledged_at", null)
    .select("id")
    .single();
  if (result.error) throw result.error;
}

export async function postHandoffNote(
  supabase: Client,
  input: { facility: CaregiverFacilityContext; userId: string; note: string },
): Promise<void> {
  const current = currentShiftFor(input.facility);
  const result = await supabase
    .from("shift_handoff_notes" as never)
    .insert({
      facility_id: input.facility.facilityId,
      organization_id: input.facility.organizationId,
      shift_date: current.serviceDate,
      shift: current.shiftType,
      note: input.note.trim(),
      priority: "normal",
      category: "other",
      created_by: input.userId,
    } as never)
    .select("id")
    .single();
  if (result.error) throw result.error;
}
