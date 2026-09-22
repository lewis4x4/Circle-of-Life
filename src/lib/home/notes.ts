import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Home W3 (COL-595): Quick note → task, and the collections contact log.
 * The database commands (migration 467) own authority, the release switch and
 * replay; this module shapes calls and parses what comes back.
 */

export const NOTE_TYPES = [
  { value: "collections", label: "Collections" },
  { value: "maintenance", label: "Maintenance" },
  { value: "staffing", label: "Staffing" },
  { value: "resident", label: "Resident" },
  { value: "other", label: "Other" },
] as const;
export type NoteType = (typeof NOTE_TYPES)[number]["value"];

const assigneeSchema = z.union([
  z.object({ kind: z.literal("queue") }),
  z.object({ kind: z.literal("user"), userId: z.string(), displayName: z.string().nullable().optional() }),
  z.object({ kind: z.literal("vendor"), vendorId: z.string(), displayName: z.string().nullable().optional() }),
]);

export const noteOnTapSchema = z.object({
  noteId: z.string(),
  noteType: z.string(),
  body: z.string(),
  followUpDate: z.string().nullable().optional(),
  overdue: z.boolean().nullable().optional(),
  assignee: assigneeSchema,
  residentId: z.string().nullable().optional(),
  updates: z.number().int().optional(),
});
export type HomeNoteOnTap = z.infer<typeof noteOnTapSchema>;

export const assigneesSchema = z.object({
  people: z.array(z.object({ userId: z.string(), displayName: z.string().nullable(), title: z.string().nullable().optional() })),
  vendors: z.array(z.object({ vendorId: z.string(), displayName: z.string() })),
});
export type HomeNoteAssignees = z.infer<typeof assigneesSchema>;

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpcOf = (supabase: SupabaseClient) => supabase.rpc.bind(supabase) as unknown as Rpc;

export async function fetchNotesOnTap(supabase: SupabaseClient, facilityId: string): Promise<HomeNoteOnTap[]> {
  const { data, error } = await rpcOf(supabase)("home_notes_on_tap", { p_facility_id: facilityId });
  if (error) throw new Error(error.message);
  return z.array(noteOnTapSchema).parse(data ?? []);
}

export async function fetchNoteAssignees(supabase: SupabaseClient, facilityId: string): Promise<HomeNoteAssignees> {
  const { data, error } = await rpcOf(supabase)("home_note_assignees", { p_facility_id: facilityId });
  if (error) throw new Error(error.message);
  return assigneesSchema.parse(data);
}

export type NoteDraft = {
  id: string;
  facilityId: string;
  noteType: NoteType;
  body: string;
  residentId: string | null;
  /** "user:<id>" | "vendor:<id>" | "" */
  assignee: string;
  followUpDate: string;
};

export function noteCreateArgs(draft: NoteDraft): Record<string, unknown> {
  const [kind, id] = draft.assignee.split(":");
  return {
    p_id: draft.id,
    p_facility_id: draft.facilityId,
    p_note_type: draft.noteType,
    p_body: draft.body.trim(),
    p_resident_id: draft.residentId || null,
    p_assignee_user_id: kind === "user" ? id : null,
    p_assignee_vendor_id: kind === "vendor" ? id : null,
    p_follow_up_date: draft.followUpDate || null,
  };
}

/** A note with an assignee or a date is a task; without either it stays a note. */
export function isTask(draft: Pick<NoteDraft, "assignee" | "followUpDate">): boolean {
  return Boolean(draft.assignee || draft.followUpDate);
}

export async function createNote(supabase: SupabaseClient, draft: NoteDraft): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await rpcOf(supabase)("home_note_create", noteCreateArgs(draft));
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function appendNote(
  supabase: SupabaseClient,
  args: { id: string; noteId: string; body: string; close: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await rpcOf(supabase)("home_note_append", { p_id: args.id, p_note_id: args.noteId, p_body: args.body.trim(), p_close: args.close });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export const CONTACT_KINDS = [
  { value: "call", label: "Called" },
  { value: "voicemail", label: "Left voicemail", hint: "Schedules a call-back for the next day." },
  { value: "escalate", label: "Escalate to the Facility Executive" },
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number]["value"];

export async function logCollectionContact(
  supabase: SupabaseClient,
  args: { id: string; residentId: string; kind: ContactKind; note: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await rpcOf(supabase)("home_log_collection_contact", {
    p_id: args.id, p_resident_id: args.residentId, p_kind: args.kind, p_note: args.note.trim(),
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export function assigneeLabel(assignee: HomeNoteOnTap["assignee"], currentUserId: string | null): string {
  if (assignee.kind === "queue") return "Facility queue";
  if (assignee.kind === "vendor") return `Vendor: ${assignee.displayName ?? "vendor"}`;
  return assignee.userId === currentUserId ? "Assigned to you" : `Assigned to ${assignee.displayName ?? "a colleague"}`;
}
