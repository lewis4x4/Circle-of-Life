/**
 * cadence-version-activator: service-role Supabase adapter for EngineStore.
 *
 * Two narrow calls and nothing else. The activation is one command, and the
 * regeneration is a POST to the task generator with its own secret. No version
 * row, no window row and no task row is read here: everything the activation
 * decides, it decides in SQL, which is what keeps this function free of a time
 * and free of the timeline invariant.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { ActivationResult, EngineStore } from "./engine.ts";

class StoreError extends Error {
  constructor(step: string, code: string | undefined) {
    super(`${step}${code ? ` (${code})` : ""}`);
    this.name = "StoreError";
  }
}

export function supabaseStore(
  admin: SupabaseClient,
  generator: { url: string | null; secret: string | null },
): EngineStore {
  return {
    async activateDueVersions(organizationId, facilityId, atIso) {
      const { data, error } = await admin.rpc("activate_due_scheduled_config_versions", {
        p_organization_id: organizationId,
        p_facility_id: facilityId,
        p_at: atIso,
      });
      if (error) throw new StoreError("activate due scheduled config versions", error.code);
      return (data ?? { ok: false, versions: [] }) as ActivationResult;
    },

    async requestRegeneration(organizationId, facilityId) {
      if (!generator.url || !generator.secret) return null;
      try {
        const response = await fetch(generator.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-secret": generator.secret },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ organization_id: organizationId, facility_id: facilityId }),
        });
        if (response.status !== 200) return false;
        const body = await response.json();
        return body.ok === true;
      } catch {
        return false;
      }
    },
  };
}
