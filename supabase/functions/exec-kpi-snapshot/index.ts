/**
 * Cron: writes `exec_kpi_snapshots` for one organization — organization, each entity, and each facility scope.
 * Auth: `x-cron-secret` must equal env `EXEC_KPI_SNAPSHOT_SECRET`.
 *
 * Body: `{ "organization_id": "<uuid>", "snapshot_date"?: "YYYY-MM-DD" }` (date defaults to UTC today).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  computeKpiForFacilityIds,
  loadEntitiesForOrganization,
  loadFacilitiesForOrganization,
} from "../_shared/exec-kpi-metrics.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  normalizedRowsForScope,
  type NormalizedMetricRow,
} from "./normalized-metrics.ts";
import { parseSnapshotRequestBody } from "./request-validation.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function utcTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
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

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const bodyResult = parseSnapshotRequestBody(parsedBody);
  if (!bodyResult.ok) {
    return jsonResponse({ error: bodyResult.error }, 400);
  }

  const { organizationId } = bodyResult.body;
  if (!UUID_RE.test(organizationId)) {
    return jsonResponse({ error: "organization_id (uuid) is required" }, 400);
  }

  const snapshotDate = bodyResult.body.snapshotDate ?? utcTodayDate();

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

    const { data: replaceResult, error: replaceErr } = await supabase
      .rpc("replace_exec_kpi_snapshot_run", {
        p_organization_id: organizationId,
        p_snapshot_date: snapshotDate,
        p_kpi_rows: rows,
        p_metric_rows: normalizedRows,
      })
      .single();

    if (replaceErr) {
      t.log({
        event: "error",
        outcome: "error",
        error_message: "snapshot replace rpc failed",
        error_code: replaceErr.code,
      });
      return jsonResponse({ error: "Database error" }, 500);
    }

    const replaceCounts = (replaceResult ?? {}) as {
      kpi_inserted_count?: number;
      kpi_soft_deleted_count?: number;
      metric_inserted_count?: number;
      metric_soft_deleted_count?: number;
    };

    t.log({
      event: "complete",
      outcome: "success",
      inserted: replaceCounts.kpi_inserted_count ?? rows.length,
      snapshot_soft_deleted: replaceCounts.kpi_soft_deleted_count ?? 0,
      normalized_inserted: replaceCounts.metric_inserted_count ?? normalizedRows.length,
      normalized_soft_deleted: replaceCounts.metric_soft_deleted_count ?? 0,
      entities: entities.length,
      facilities: allFacs.length,
    });

    return jsonResponse({
      ok: true,
      organization_id: organizationId,
      snapshot_date: snapshotDate,
      inserted: replaceCounts.kpi_inserted_count ?? rows.length,
      snapshot_soft_deleted: replaceCounts.kpi_soft_deleted_count ?? 0,
      normalized_inserted: replaceCounts.metric_inserted_count ?? normalizedRows.length,
      normalized_soft_deleted: replaceCounts.metric_soft_deleted_count ?? 0,
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
