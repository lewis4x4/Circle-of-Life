import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type VitalKey = "temperature" | "blood_pressure_systolic" | "blood_pressure_diastolic" | "pulse";
export function parseVitalMeasurements(fields: Partial<Record<VitalKey, string>>): Partial<Record<VitalKey, number>> {
  const measurements: Partial<Record<VitalKey, number>> = {};
  for (const [key, raw] of Object.entries(fields)) {
    if (!raw.trim()) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || (key !== "temperature" && !Number.isInteger(value))) {
      throw new Error(`Enter a valid ${key.replaceAll("_", " ")} measurement.`);
    }
    measurements[key as VitalKey] = value;
  }
  if (Object.keys(measurements).length === 0) throw new Error("Enter at least one measurement.");
  return measurements;
}

export async function appendShiftNote(client: SupabaseClient<Database>, residentId: string, note: string): Promise<string> {
  const { data, error } = await client.rpc("append_caregiver_shift_note" as never, { p_resident_id: residentId, p_note: note.trim() } as never);
  if (error) throw error;
  if (typeof data !== "string") throw new Error("The note was not acknowledged. Keep your draft and retry.");
  return data;
}

export async function recordVitals(client: SupabaseClient<Database>, residentId: string, measurements: Partial<Record<VitalKey, number>>, observedAt: string): Promise<string> {
  const { data, error } = await client.rpc("record_caregiver_vitals" as never, { p_resident_id: residentId, p_measurements: measurements, p_observed_at: observedAt } as never);
  if (error) throw error;
  if (typeof data !== "string") throw new Error("The observation was not acknowledged. Keep your draft and retry.");
  return data;
}
