/**
 * Executive alert evaluator (Track C5) — creates `exec_alerts` from live KPI metrics when
 * thresholds are crossed. Complements scheduled `exec-kpi-snapshot` (historical) with actionable alerts.
 *
 * POST body: `{ "organization_id": uuid, "max_facilities"?: number }`
 * Auth: `x-cron-secret` must equal env `EXEC_ALERT_EVALUATOR_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  computeKpiForFacilityIds,
  loadFacilitiesForOrganization,
} from "../_shared/exec-kpi-metrics.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const t = withTiming("exec-alert-evaluator");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("EXEC_ALERT_EVALUATOR_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let body: { organization_id?: string; max_facilities?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const organizationId = body.organization_id?.trim();
  if (!organizationId || !UUID_RE.test(organizationId)) {
    return jsonResponse({ error: "organization_id (uuid) is required" }, 400);
  }

  const cap = Math.min(Math.max(Number(body.max_facilities) || 50, 1), 100);
  const facilities = (await loadFacilitiesForOrganization(admin, organizationId)).slice(0, cap);

  let alertsInserted = 0;

  for (const fac of facilities) {
    const kpi = await computeKpiForFacilityIds(admin, organizationId, [fac]);
    const deep = `/admin/executive/alerts?facility=${fac.id}`;

    if (kpi.clinical.openIncidents > 0) {
      const title = `Open incidents at facility (${fac.id.slice(0, 8)}…)`;
      const { data: dup } = await admin
        .from("exec_alerts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("facility_id", fac.id)
        .eq("title", title)
        .is("deleted_at", null)
        .is("resolved_at", null)
        .maybeSingle();
      if (!dup) {
        const { error } = await admin.from("exec_alerts").insert({
          organization_id: organizationId,
          facility_id: fac.id,
          source_module: "incidents",
          severity: "warning",
          title,
          body: `${kpi.clinical.openIncidents} open incident(s). Review triage queue.`,
          deep_link_path: deep,
        });
        if (!error) alertsInserted += 1;
      }
    }

    if (kpi.financial.totalBalanceDueCents > 2_500_000) {
      // $25,000+ open AR (cents)
      const title = `High AR balance — facility (${fac.id.slice(0, 8)}…)`;
      const { data: dup } = await admin
        .from("exec_alerts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("facility_id", fac.id)
        .eq("title", title)
        .is("deleted_at", null)
        .is("resolved_at", null)
        .maybeSingle();
      if (!dup) {
        const { error } = await admin.from("exec_alerts").insert({
          organization_id: organizationId,
          facility_id: fac.id,
          source_module: "billing",
          severity: "warning",
          title,
          body: `Outstanding balance due approximately $${(kpi.financial.totalBalanceDueCents / 100).toFixed(0)}.`,
          deep_link_path: `/admin/billing/ar-aging`,
        });
        if (!error) alertsInserted += 1;
      }
    }

    if (kpi.infection.activeOutbreaks > 0) {
      const title = `Active infection outbreak flag — facility (${fac.id.slice(0, 8)}…)`;
      const { data: dup } = await admin
        .from("exec_alerts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("facility_id", fac.id)
        .eq("title", title)
        .is("deleted_at", null)
        .is("resolved_at", null)
        .maybeSingle();
      if (!dup) {
        const { error } = await admin.from("exec_alerts").insert({
          organization_id: organizationId,
          facility_id: fac.id,
          source_module: "infection",
          severity: "critical",
          title,
          body: `${kpi.infection.activeOutbreaks} active outbreak(s) recorded.`,
          deep_link_path: deep,
        });
        if (!error) alertsInserted += 1;
      }
    }
  }

  t.log({
    event: "complete",
    outcome: "success",
    facilities_evaluated: facilities.length,
    alerts_inserted: alertsInserted,
  });

  return jsonResponse({
    ok: true,
    organization_id: organizationId,
    facilities_evaluated: facilities.length,
    alerts_inserted: alertsInserted,
  });
});
