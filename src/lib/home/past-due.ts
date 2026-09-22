import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Past-due rent for Home W2 (COL-594), as `public.home_past_due` returns it
 * (migration 461). Due day and grace are facility configuration; a facility
 * with none in effect is "not configured", never "nobody owes".
 */

const residentSchema = z.object({
  residentId: z.string(),
  name: z.string(),
  oldestDueDate: z.string(),
  daysPastDue: z.number().int(),
  openCents: z.number().int(),
});

export const homePastDueSchema = z.object({
  configured: z.boolean(),
  localDate: z.string().nullable().optional(),
  graceDays: z.number().int().optional(),
  defaultDueDay: z.number().int().optional(),
  residents: z.array(residentSchema),
});

export type HomePastDue = z.infer<typeof homePastDueSchema>;
export type HomePastDueResident = z.infer<typeof residentSchema>;

export async function fetchHomePastDue(supabase: SupabaseClient, facilityId: string): Promise<HomePastDue> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: { p_facility_id: string }) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("home_past_due", { p_facility_id: facilityId });
  if (error) throw new Error(error.message);
  return homePastDueSchema.parse(data);
}

export function pastDueTotalCents(pastDue: HomePastDue): number {
  return pastDue.residents.reduce((sum, resident) => sum + resident.openCents, 0);
}
