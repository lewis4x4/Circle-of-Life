/**
 * Cron: writes `exec_kpi_snapshots` for one organization — organization, each entity, and each facility scope.
 * Auth: `x-cron-secret` must equal env `EXEC_KPI_SNAPSHOT_SECRET`.
 *
 * Body: `{ "organization_id": "<uuid>", "snapshot_date"?: "YYYY-MM-DD" }` (date defaults to UTC today).
 */
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  computeKpiForFacilityIds,
  loadEntitiesForOrganization,
  loadFacilitiesForOrganization,
} from "../_shared/exec-kpi-metrics.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  applyReplacementScopeFilters,
  buildReplacementScopes,
  normalizedRowsForScope,
  type NormalizedMetricRow,
  type NormalizedReplacementScope,
} from "./normalized-metrics.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function utcTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}


async function softDeleteActiveNormalizedRows(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    snapshotDate: string;
    scopes: NormalizedReplacementScope[];
  },
): Promise<
  { error: { message: string; code?: string } | null; count: number }
> {
  const deletedAt = new Date().toISOString();
  let count = 0;

  for (const scope of input.scopes) {
    let query = supabase
      .from("exec_metric_snapshots")
      .update({ deleted_at: deletedAt })
      .eq("organization_id", input.organizationId)
      .eq("snapshot_date", input.snapshotDate)
      .is("deleted_at", null);

    query = applyReplacementScopeFilters(query, scope);

    const { error } = await query;
    if (error) return { error, count };
    count += 1;
  }

  return { error: null, count };
}

Deno.serve(async (req) => {
  const t = withTiming("exec-kpi-snapshot");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("EXEC_KPI_SNAPSHOT_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    t.log({
      event: "auth_failed",
      outcome: "error",
      error_message: "secret mismatch",
    });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return jsonResponse({ error: "Server configuration error" }, 503);
  }

  let body: { organization_id?: string; snapshot_date?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const organizationId = body.organization_id?.trim();
  if (!organizationId || !UUID_RE.test(organizationId)) {
    return jsonResponse({ error: "organization_id (uuid) is required" }, 400);
  }

  let snapshotDate = body.snapshot_date?.trim();
  if (snapshotDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      return jsonResponse({ error: "snapshot_date must be YYYY-MM-DD" }, 400);
    }
  } else {
    snapshotDate = utcTodayDate();
  }

  const supabase = createClient(url, serviceKey);

  const { data: orgRow, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (orgErr) {
    t.log({
      event: "error",
      outcome: "error",
      error_message: "org lookup failed",
      error_code: orgErr.code,
    });
    return jsonResponse({ error: "Database error" }, 500);
  }
  if (!orgRow) {
    return jsonResponse({ error: "Organization not found" }, 404);
  }

  t.log({
    event: "start",
    organization_id: organizationId,
    snapshot_date: snapshotDate,
  });

  try {
    const { error: delErr } = await supabase
      .from("exec_kpi_snapshots")
      .delete()
      .eq("organization_id", organizationId)
      .eq("snapshot_date", snapshotDate);

    if (delErr) {
      t.log({
        event: "error",
        outcome: "error",
        error_message: "delete failed",
        error_code: delErr.code,
      });
      return jsonResponse({ error: "Database error" }, 500);
    }

    const allFacs = await loadFacilitiesForOrganization(
      supabase,
      organizationId,
    );
    const entities = await loadEntitiesForOrganization(
      supabase,
      organizationId,
    );

    type InsertRow = {
      organization_id: string;
      scope_type: "organization" | "entity" | "facility";
      scope_id: string;
      snapshot_date: string;
      metrics_version: number;
      metrics: Record<string, unknown>;
      lineage: { table: string; id: string }[];
      computed_by: string;
    };

    const rows: InsertRow[] = [];
    const normalizedRows: NormalizedMetricRow[] = [];

    const orgMetrics = await computeKpiForFacilityIds(
      supabase,
      organizationId,
      allFacs,
      { snapshotDate },
    );
    rows.push({
      organization_id: organizationId,
      scope_type: "organization",
      scope_id: organizationId,
      snapshot_date: snapshotDate,
      metrics_version: orgMetrics.version,
      metrics: orgMetrics as unknown as Record<string, unknown>,
      lineage: [{ table: "organizations", id: organizationId }],
      computed_by: "edge:exec-kpi-snapshot",
    });
    normalizedRows.push(
      ...normalizedRowsForScope({
        organizationId,
        snapshotDate,
        sourceVersion: orgMetrics.version,
        entityId: null,
        facilityId: null,
        metrics: orgMetrics.dashboardMetrics,
      }),
    );

    for (const ent of entities) {
      const facsForEntity = allFacs.filter((f) => f.entity_id === ent.id);
      const entMetrics = await computeKpiForFacilityIds(
        supabase,
        organizationId,
        facsForEntity,
        { snapshotDate },
      );
      rows.push({
        organization_id: organizationId,
        scope_type: "entity",
        scope_id: ent.id,
        snapshot_date: snapshotDate,
        metrics_version: entMetrics.version,
        metrics: entMetrics as unknown as Record<string, unknown>,
        lineage: [
          { table: "entities", id: ent.id },
          { table: "organizations", id: organizationId },
        ],
        computed_by: "edge:exec-kpi-snapshot",
      });
      normalizedRows.push(
        ...normalizedRowsForScope({
          organizationId,
          snapshotDate,
          sourceVersion: entMetrics.version,
          entityId: ent.id,
          facilityId: null,
          metrics: entMetrics.dashboardMetrics,
        }),
      );
    }

    for (const fac of allFacs) {
      const facMetrics = await computeKpiForFacilityIds(
        supabase,
        organizationId,
        [fac],
        { snapshotDate },
      );
      rows.push({
        organization_id: organizationId,
        scope_type: "facility",
        scope_id: fac.id,
        snapshot_date: snapshotDate,
        metrics_version: facMetrics.version,
        metrics: facMetrics as unknown as Record<string, unknown>,
        lineage: [
          { table: "facilities", id: fac.id },
          { table: "organizations", id: organizationId },
        ],
        computed_by: "edge:exec-kpi-snapshot",
      });
      normalizedRows.push(
        ...normalizedRowsForScope({
          organizationId,
          snapshotDate,
          sourceVersion: facMetrics.version,
          entityId: fac.entity_id,
          facilityId: fac.id,
          metrics: facMetrics.dashboardMetrics,
        }),
      );
    }

    const replacementScopes = buildReplacementScopes({
      entityIds: entities.map((entity) => entity.id),
      facilityIds: allFacs.map((facility) => facility.id),
    });

    const { error: insErr } = await supabase.from("exec_kpi_snapshots").insert(
      rows,
    );
    if (insErr) {
      t.log({
        event: "error",
        outcome: "error",
        error_message: "insert failed",
        error_code: insErr.code,
      });
      return jsonResponse({ error: "Database error" }, 500);
    }

    if (replacementScopes.length > 0) {
      const softDeleteRes = await softDeleteActiveNormalizedRows(
        supabase,
        {
          organizationId,
          snapshotDate,
          scopes: replacementScopes,
        },
      );
      if (softDeleteRes.error) {
        t.log({
          event: "error",
          outcome: "error",
          error_message: "normalized soft-delete failed",
          error_code: softDeleteRes.error.code,
        });
        return jsonResponse({ error: "Database error" }, 500);
      }

      if (normalizedRows.length > 0) {
        const { error: normalizedInsErr } = await supabase.from(
          "exec_metric_snapshots",
        ).insert(normalizedRows);
        if (normalizedInsErr) {
          t.log({
            event: "error",
            outcome: "error",
            error_message: "normalized insert failed",
            error_code: normalizedInsErr.code,
          });
          return jsonResponse({ error: "Database error" }, 500);
        }
      }
    }

    t.log({
      event: "complete",
      outcome: "success",
      inserted: rows.length,
      normalized_inserted: normalizedRows.length,
      normalized_replaced_scopes: replacementScopes.length,
      entities: entities.length,
      facilities: allFacs.length,
    });

    return jsonResponse({
      ok: true,
      organization_id: organizationId,
      snapshot_date: snapshotDate,
      inserted: rows.length,
      normalized_inserted: normalizedRows.length,
      normalized_replaced_scopes: replacementScopes.length,
      scopes: {
        organization: 1,
        entity: entities.length,
        facility: allFacs.length,
      },
    });
  } catch (e) {
    t.log({
      event: "error",
      outcome: "error",
      error_message: e instanceof Error ? e.message : String(e),
    });
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
