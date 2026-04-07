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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function utcTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("EXEC_KPI_SNAPSHOT_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
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
    console.error("[exec-kpi-snapshot] org lookup", orgErr);
    return jsonResponse({ error: "Database error" }, 500);
  }
  if (!orgRow) {
    return jsonResponse({ error: "Organization not found" }, 404);
  }

  try {
    const { error: delErr } = await supabase
      .from("exec_kpi_snapshots")
      .delete()
      .eq("organization_id", organizationId)
      .eq("snapshot_date", snapshotDate);

    if (delErr) {
      console.error("[exec-kpi-snapshot] delete", delErr);
      return jsonResponse({ error: "Database error" }, 500);
    }

    const allFacs = await loadFacilitiesForOrganization(supabase, organizationId);
    const entities = await loadEntitiesForOrganization(supabase, organizationId);

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

    const orgMetrics = await computeKpiForFacilityIds(supabase, organizationId, allFacs);
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

    for (const ent of entities) {
      const facsForEntity = allFacs.filter((f) => f.entity_id === ent.id);
      const entMetrics = await computeKpiForFacilityIds(supabase, organizationId, facsForEntity);
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
    }

    for (const fac of allFacs) {
      const facMetrics = await computeKpiForFacilityIds(supabase, organizationId, [fac]);
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
    }

    const { error: insErr } = await supabase.from("exec_kpi_snapshots").insert(rows);
    if (insErr) {
      console.error("[exec-kpi-snapshot] insert", insErr);
      return jsonResponse({ error: "Database error" }, 500);
    }

    return jsonResponse({
      ok: true,
      organization_id: organizationId,
      snapshot_date: snapshotDate,
      inserted: rows.length,
      scopes: {
        organization: 1,
        entity: entities.length,
        facility: allFacs.length,
      },
    });
  } catch (e) {
    console.error("[exec-kpi-snapshot]", e);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
