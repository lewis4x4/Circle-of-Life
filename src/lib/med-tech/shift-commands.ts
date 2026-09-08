import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

type ShiftDatabase = { public: {
  Tables: { med_tech_shifts: {
    Row: { id: string; user_id: string; facility_id: string; organization_id: string; shift_start: string; shift_end: string; status: string; deleted_at: string | null };
    Insert: never; Update: never; Relationships: [];
  } };
  Views: Record<never, never>; Functions: Record<never, never>;
} };

/** The legacy generated database type omits the cockpit tables. */
export function medicationShiftRows() {
  return (createClient() as unknown as SupabaseClient<ShiftDatabase>).from("med_tech_shifts");
}

export interface MedicationShiftInput {
  id: string;
  facilityId: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  residentIds: string[];
}

type Command = (name: string, parameters: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

export class MedicationShiftCommandError extends Error {
  constructor(message: string, public readonly definitive: boolean) {
    super(message);
    this.name = "MedicationShiftCommandError";
  }
}

async function command(name: string, parameters: Record<string, unknown>): Promise<string> {
  const client = createClient();
  const result = await (client.rpc.bind(client) as unknown as Command)(name, parameters);
  if (result.error) throw new MedicationShiftCommandError(result.error.message, /^[0-9A-Z]{5}$/.test(result.error.code ?? ""));
  if (typeof result.data !== "string" || !result.data) throw new Error("The medication assignment was not confirmed. Retry the same request.");
  return result.data;
}

export function createMedicationShift(input: MedicationShiftInput): Promise<string> {
  return command("create_med_tech_shift", {
    p_id: input.id,
    p_facility_id: input.facilityId,
    p_user_id: input.userId,
    p_shift_start: input.startsAt,
    p_shift_end: input.endsAt,
    p_resident_ids: input.residentIds,
  });
}

export function startMedicationShift(shiftId: string): Promise<string> {
  return command("start_med_tech_shift", { p_shift_id: shiftId });
}

export interface MedicationShiftStaff {
  id: string;
  full_name: string;
  app_role: "med_tech" | "nurse";
}

export async function listMedicationShiftStaff(facilityId: string): Promise<MedicationShiftStaff[]> {
  const client = createClient();
  const result = await (client.rpc.bind(client) as unknown as Command)("list_medication_shift_staff", { p_facility_id: facilityId });
  if (result.error) throw new Error(result.error.message);
  if (!Array.isArray(result.data)) throw new Error("Medication staff options were not returned. Retry loading them.");
  return result.data as MedicationShiftStaff[];
}
