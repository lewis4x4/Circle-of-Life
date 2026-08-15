import { createClient } from "@/lib/supabase/client";

export type ApplyColDiscoveryPlanResult =
  | { ok: true; planId: string }
  | { ok: false; code: "plantation_pending" | "not_configured" | "forbidden" | "error"; message: string };

function mapRpcError(message: string): ApplyColDiscoveryPlanResult {
  const normalized = message.toLowerCase();

  if (normalized.includes("plantation") && normalized.includes("pending")) {
    return {
      ok: false,
      code: "plantation_pending",
      message: "Plantation discovery cadence is pending owner decision. Apply defaults after Jessica supplies times.",
    };
  }

  if (normalized.includes("not configured for col discovery")) {
    return {
      ok: false,
      code: "not_configured",
      message: "This facility is not configured for COL discovery-round cadence.",
    };
  }

  if (normalized.includes("facility access denied") || normalized.includes("insufficient role")) {
    return {
      ok: false,
      code: "forbidden",
      message: "You do not have permission to apply discovery-round defaults for this resident.",
    };
  }

  return { ok: false, code: "error", message: "Could not apply discovery-round default. Confirm resident scope and retry." };
}

export async function applyColDiscoveryObservationPlan(residentId: string): Promise<ApplyColDiscoveryPlanResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("apply_col_discovery_round_observation_plan" as never, {
    p_resident_id: residentId,
  } as never);

  if (error) {
    return mapRpcError(error.message);
  }

  if (typeof data !== "string" || !data) {
    return { ok: false, code: "error", message: "Discovery-round default did not return a plan id." };
  }

  return { ok: true, planId: data };
}
