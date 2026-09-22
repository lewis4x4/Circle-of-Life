import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Home W4 (COL-596): call-out from Home. The database (migration 468) marks the
 * shift, writes the attendance event Stand Up counts, and tracks cover.
 */

const shiftSchema = z.object({
  assignmentId: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  shiftType: z.string(),
  status: z.string(),
  customStart: z.string().nullable().optional(),
  customEnd: z.string().nullable().optional(),
  coversAssignmentId: z.string().nullable().optional(),
  uncovered: z.boolean(),
});
export const shiftsTodaySchema = z.object({
  localDate: z.string(),
  shifts: z.array(shiftSchema),
  staff: z.array(z.object({ staffId: z.string(), staffName: z.string() })),
});
export type HomeShiftsToday = z.infer<typeof shiftsTodaySchema>;
export type HomeShift = z.infer<typeof shiftSchema>;

export const CALLOUT_REASONS = [
  { value: "sick", label: "Sick" },
  { value: "family", label: "Family" },
  { value: "no_show", label: "No-show" },
  { value: "other", label: "Other" },
] as const;
export type CalloutReason = (typeof CALLOUT_REASONS)[number]["value"];

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpcOf = (supabase: SupabaseClient) => supabase.rpc.bind(supabase) as unknown as Rpc;

export async function fetchShiftsToday(supabase: SupabaseClient, facilityId: string): Promise<HomeShiftsToday> {
  const { data, error } = await rpcOf(supabase)("home_shifts_today", { p_facility_id: facilityId });
  if (error) throw new Error(error.message);
  return shiftsTodaySchema.parse(data);
}

export async function recordCallout(
  supabase: SupabaseClient,
  args: { eventId: string; assignmentId: string; reason: CalloutReason; note: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await rpcOf(supabase)("home_record_callout", {
    p_event_id: args.eventId, p_assignment_id: args.assignmentId, p_reason: args.reason, p_note: args.note.trim() || null,
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function coverShift(
  supabase: SupabaseClient,
  args: { id: string; assignmentId: string; staffId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await rpcOf(supabase)("home_cover_shift", { p_id: args.id, p_called_out_assignment_id: args.assignmentId, p_staff_id: args.staffId });
  return error ? { ok: false, message: error.message } : { ok: true };
}

const SHIFT_LABEL: Record<string, string> = { day: "Day", evening: "Evening", night: "Night", custom: "Custom" };

export function shiftLabel(shift: Pick<HomeShift, "shiftType" | "customStart" | "customEnd">): string {
  if (shift.shiftType === "custom" && shift.customStart && shift.customEnd) {
    return `${shift.customStart.slice(0, 5)}–${shift.customEnd.slice(0, 5)}`;
  }
  return `${SHIFT_LABEL[shift.shiftType] ?? shift.shiftType} shift`;
}

/** Shifts someone can still call out of today, scheduled staff first. */
export function callableShifts(today: HomeShiftsToday): HomeShift[] {
  return today.shifts.filter((shift) => ["assigned", "confirmed", "swap_requested"].includes(shift.status));
}
