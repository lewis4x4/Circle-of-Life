import { createClient } from "@/lib/supabase/client";

import {
  getColDiscoveryCadenceProfile,
  resolveColDiscoveryCadenceKey,
} from "@/lib/rounding/col-discovery-round-cadence";

export type ApplyColDiscoveryForFacilityResult =
  | { ok: true; appliedCount: number }
  | {
      ok: false;
      code: "empty_census" | "plantation_pending" | "not_configured" | "forbidden" | "error";
      message: string;
    };

export async function applyColDiscoveryForFacility(args: {
  facilityId: string;
  facilityName: string;
}): Promise<ApplyColDiscoveryForFacilityResult> {
  const cadenceKey = resolveColDiscoveryCadenceKey(args.facilityName);
  if (!cadenceKey) {
    return {
      ok: false,
      code: "not_configured",
      message: "This facility is not configured for COL discovery-round cadence.",
    };
  }

  if (getColDiscoveryCadenceProfile(cadenceKey) === "pending") {
    return {
      ok: false,
      code: "plantation_pending",
      message:
        "Plantation discovery cadence is pending owner decision. Apply defaults after Jessica supplies times.",
    };
  }

  const supabase = createClient();
  const { data: residents, error: residentsError } = await supabase
    .from("residents")
    .select("id")
    .eq("facility_id", args.facilityId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (residentsError) {
    return {
      ok: false,
      code: "error",
      message: "Could not load facility census. Confirm facility scope and retry.",
    };
  }

  const residentIds = (residents ?? []).map((row) => row.id);
  if (residentIds.length === 0) {
    return {
      ok: false,
      code: "empty_census",
      message:
        "No active residents at this facility right now. Apply discovery rounds once census is loaded.",
    };
  }

  for (const residentId of residentIds) {
    const response = await fetch("/api/rounding/plans/apply-discovery-default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, facilityId: args.facilityId }),
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      if (response.status === 403) {
        return {
          ok: false,
          code: "forbidden",
          message: json.error ?? "You do not have permission to apply discovery defaults.",
        };
      }

      return {
        ok: false,
        code: "error",
        message: json.error ?? "Could not apply discovery-round default for every resident.",
      };
    }
  }

  const now = new Date();
  const generateResponse = await fetch("/api/rounding/generate-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      facilityId: args.facilityId,
      windowStart: now.toISOString(),
      windowEnd: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    }),
  });

  if (!generateResponse.ok) {
    return {
      ok: false,
      code: "error",
      message:
        "Discovery plans were applied, but live tasks could not be generated. Open the live board and retry.",
    };
  }

  return { ok: true, appliedCount: residentIds.length };
}
