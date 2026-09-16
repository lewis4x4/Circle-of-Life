import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;

export type FacilityAccessGrantInput = {
  user_id: string;
  facility_id: string;
  organization_id: string;
  is_primary: boolean;
  granted_by: string;
};

/**
 * What a single grant did. `inserted` and `reactivated` are the only outcomes the
 * caller may undo — `unchanged` and `updated` sit on a row that predates the request
 * (Charlene's 2026-08-19 Homewood grant is the case that matters), and deleting or
 * revoking those on rollback would destroy access nobody asked us to touch.
 */
export type FacilityAccessGrantOutcome = "inserted" | "reactivated" | "updated" | "unchanged";

export type FacilityAccessGrantResult = {
  facility_id: string;
  row_id: string | null;
  outcome: FacilityAccessGrantOutcome;
  /** Prior column values, so `updated` rows can be restored rather than deleted. */
  previous: { is_primary: boolean; granted_by: string | null; organization_id: string } | null;
};

/**
 * Idempotent facility grants for user create: reactivate revoked rows, update active
 * duplicates, or insert new grants without tripping idx_ufa_unique.
 */
export async function ensureUserFacilityAccessGrants(
  admin: AdminClient,
  grants: FacilityAccessGrantInput[],
): Promise<{ error: string | null; applied: FacilityAccessGrantResult[] }> {
  const applied: FacilityAccessGrantResult[] = [];

  for (const grant of grants) {
    const { data: rows, error: lookupErr } = await admin
      .from("user_facility_access")
      .select("id, revoked_at, is_primary, granted_by, organization_id")
      .eq("user_id", grant.user_id)
      .eq("facility_id", grant.facility_id)
      .order("granted_at", { ascending: false })
      .limit(5);

    if (lookupErr) {
      return { error: lookupErr.message, applied };
    }

    const active = (rows ?? []).find((row) => row.revoked_at === null);
    if (active) {
      const previous = {
        is_primary: active.is_primary,
        granted_by: active.granted_by ?? null,
        organization_id: active.organization_id,
      };

      // A repeat grant that changes nothing is a no-op: no write, no audit noise, and
      // nothing for rollback to undo.
      if (
        active.is_primary === grant.is_primary &&
        active.granted_by === grant.granted_by &&
        active.organization_id === grant.organization_id
      ) {
        applied.push({
          facility_id: grant.facility_id,
          row_id: active.id,
          outcome: "unchanged",
          previous,
        });
        continue;
      }

      const { error: updateErr } = await admin
        .from("user_facility_access")
        .update({
          is_primary: grant.is_primary,
          granted_by: grant.granted_by,
          organization_id: grant.organization_id,
        })
        .eq("id", active.id);
      if (updateErr) {
        return { error: updateErr.message, applied };
      }
      applied.push({
        facility_id: grant.facility_id,
        row_id: active.id,
        outcome: "updated",
        previous,
      });
      continue;
    }

    const revoked = (rows ?? []).find((row) => row.revoked_at !== null);
    if (revoked) {
      const { error: reactivateErr } = await admin
        .from("user_facility_access")
        .update({
          revoked_at: null,
          revoked_by: null,
          is_primary: grant.is_primary,
          granted_by: grant.granted_by,
          organization_id: grant.organization_id,
          granted_at: new Date().toISOString(),
        })
        .eq("id", revoked.id);
      if (reactivateErr) {
        return { error: reactivateErr.message, applied };
      }
      applied.push({
        facility_id: grant.facility_id,
        row_id: revoked.id,
        outcome: "reactivated",
        previous: {
          is_primary: revoked.is_primary,
          granted_by: revoked.granted_by ?? null,
          organization_id: revoked.organization_id,
        },
      });
      continue;
    }

    const { data: insertedRow, error: insertErr } = await admin
      .from("user_facility_access")
      .insert({
        user_id: grant.user_id,
        facility_id: grant.facility_id,
        organization_id: grant.organization_id,
        is_primary: grant.is_primary,
        granted_by: grant.granted_by,
      })
      .select("id")
      .single();
    if (insertErr) {
      return { error: insertErr.message, applied };
    }
    applied.push({
      facility_id: grant.facility_id,
      row_id: insertedRow?.id ?? null,
      outcome: "inserted",
      previous: null,
    });
  }

  return { error: null, applied };
}

/**
 * Undo grants written by a single failed create request. Only `inserted` rows are
 * deleted and only `reactivated` rows are re-revoked; rows that already existed are
 * restored to their prior column values, never removed.
 */
export async function rollbackUserFacilityAccessGrants(
  admin: AdminClient,
  applied: FacilityAccessGrantResult[],
): Promise<{ error: string | null }> {
  for (const result of [...applied].reverse()) {
    if (!result.row_id) {
      continue;
    }

    if (result.outcome === "inserted") {
      const { error } = await admin.from("user_facility_access").delete().eq("id", result.row_id);
      if (error) {
        return { error: error.message };
      }
      continue;
    }

    if (result.outcome === "reactivated") {
      const { error } = await admin
        .from("user_facility_access")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", result.row_id);
      if (error) {
        return { error: error.message };
      }
      continue;
    }

    if (result.outcome === "updated" && result.previous) {
      const { error } = await admin
        .from("user_facility_access")
        .update({
          is_primary: result.previous.is_primary,
          granted_by: result.previous.granted_by,
          organization_id: result.previous.organization_id,
        })
        .eq("id", result.row_id);
      if (error) {
        return { error: error.message };
      }
    }
  }

  return { error: null };
}
