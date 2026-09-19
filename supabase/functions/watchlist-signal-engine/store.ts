/**
 * watchlist-signal-engine: service-role Supabase adapter for EngineStore.
 *
 * Two narrow calls and nothing else. The facility list reads ids, and the
 * evaluation is one command per building. No resident row, no signal row and no
 * recipient is ever read here: everything the rules decide, the rules decide in
 * SQL, which is what keeps this function free of a threshold.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { EngineStore, EvaluationResult } from "./engine.ts";

class StoreError extends Error {
  constructor(step: string, code: string | undefined) {
    super(`${step}${code ? ` (${code})` : ""}`);
    this.name = "StoreError";
  }
}

export function supabaseStore(admin: SupabaseClient): EngineStore {
  return {
    async loadFacilityIds(organizationId, facilityId) {
      let query = admin
        .from("facilities")
        .select("id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("id", { ascending: true });
      if (facilityId) query = query.eq("id", facilityId);

      const { data, error } = await query;
      if (error) throw new StoreError("load facilities", error.code);
      return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    },

    async evaluateFacility(facilityId, atIso) {
      const { data, error } = await admin.rpc("evaluate_watchlist_signals", {
        p_facility_id: facilityId,
        p_as_of: atIso,
      });
      if (error) throw new StoreError("evaluate watchlist signals", error.code);
      return (data ?? { ok: false, reason: "no_result" }) as EvaluationResult;
    },
  };
}
