import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { databaseUuidSchema as uuid } from "@/lib/operations/database-uuid";

const statusSchema = z.array(z.object({ resident_id: uuid, case_id: uuid.nullable(), kind: z.enum(["case", "screening", "none"]), label: z.string() }));
export type MedicaidStatus = z.infer<typeof statusSchema>[number];

/**
 * Medicaid status for admission screens, read from the benefits workflow (COL-772) instead of the retired
 * admission stage: the active case's next board step, else the latest answers, else "Not asked".
 * Returns null when the viewer has no Medicaid access or the reply cannot be verified — callers show
 * nothing rather than a guess. Residents outside the viewer's Medicaid facilities are simply absent.
 */
export async function loadMedicaidStatuses(client: Pick<SupabaseClient, "rpc">, residentIds: string[]): Promise<Map<string, MedicaidStatus> | null> {
  const ids = [...new Set(residentIds.filter((id) => uuid.safeParse(id).success))].slice(0, 500);
  if (ids.length === 0) return new Map();
  const { data, error } = await client.rpc("benefits_medicaid_status" as never, { p_resident_ids: ids } as never);
  if (error) return null;
  const parsed = statusSchema.safeParse(data);
  if (!parsed.success) return null;
  return new Map(parsed.data.map((row) => [row.resident_id, row]));
}
