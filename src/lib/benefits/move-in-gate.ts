import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * COL-575: before move-in, anyone expected to rely on Medicaid needs a preliminary review showing they are likely
 * to qualify (the admission Medicaid questions returned "candidate"), or a Facility Executive override with a reason.
 * Evaluated by migration 528's service-only RPC; the admissions route calls it with the service client.
 */
export const MOVE_IN_GATE_OVERRIDE_ROLES = ["owner", "org_admin", "facility_admin"] as const;

const gateSchema = z.object({
  applies: z.boolean(),
  satisfied: z.boolean(),
  overridden: z.boolean(),
  result: z.string().nullable(),
  reason: z.string().nullable(),
});
export type MoveInMedicaidGate = z.infer<typeof gateSchema>;

export async function loadMoveInMedicaidGate(
  client: Pick<SupabaseClient, "rpc">,
  admissionCaseId: string,
  anticipatedPayerSource: string | null,
): Promise<MoveInMedicaidGate> {
  const { data, error } = await client.rpc("benefits_move_in_gate" as never, {
    p_admission_case_id: admissionCaseId,
    p_anticipated_payer_source: anticipatedPayerSource,
  } as never);
  if (error) throw error;
  return gateSchema.parse(data);
}

export function moveInGateOverrideAllowed(role: string) {
  return (MOVE_IN_GATE_OVERRIDE_ROLES as readonly string[]).includes(role);
}
