/**
 * Executive alert evaluator v2 — dynamic rule-driven alerts
 *
 * Reads `exec_alert_rules` for the organization, evaluates each rule against
 * live KPI metrics per facility, and inserts alerts when thresholds are crossed.
 * Computes a dynamic score: severity_weight × impact_weight × recency_factor.
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

// ── Types ──

interface AlertRule {
  id: string;
  metric_domain: string;
  severity: string;
  condition_op: string;
  condition_value: number;
  condition_value_upper: number | null;
  alert_title_template: string;
  alert_body_template: string | null;
  source_module: string;
  deep_link_template: string | null;
  severity_weight: number;
  impact_weight: number;
  category: string;
  why_it_matters: string | null;
}

// ── Helpers ──

/** Resolve a dotted path like "clinical.openIncidents" from a nested object */
function resolvePath(obj: Record<string, unknown>, path: string): number | null {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" ? current : null;
}

/** Evaluate a condition operator */
function evaluateCondition(
  value: number,
  op: string,
  threshold: number,
  upper: number | null,
): boolean {
  switch (op) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
    case "neq": return value !== threshold;
    case "between": return upper != null && value >= threshold && value <= upper;
    default: return false;
  }
}

/** Replace template placeholders using string replaceAll (no regex, safe from special chars) */
function fillTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(val));
  }
  return result;
}

/** Allowed metric domain paths for threshold evaluation */
const ALLOWED_METRIC_DOMAINS = new Set([
  "census.occupancyPct",
  "census.occupiedResidents",
  "census.licensedBeds",
  "financial.openInvoicesCount",
  "financial.totalBalanceDueCents",
  "clinical.openIncidents",
  "clinical.medicationErrorsMtd",
  "compliance.openSurveyDeficiencies",
  "workforce.certificationsExpiring30d",
  "infection.activeOutbreaks",
  "residentAssurance.overdueTasksCount",
  "residentAssurance.missedRate",
  "residentAssurance.openExceptions",
  "residentAssurance.activeWatchCount",
]);

/** Recency factor: alerts older than 24h get reduced score */
function recencyFactor(): number {
  // New alerts get full weight; this could be refined with last_evaluated_at
  return 1.0;
}

// ── Main handler ──

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

  // ── Load dynamic rules ──
  const { data: rules, error: rulesErr } = await admin
    .from("exec_alert_rules")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (rulesErr) {
    t.log({ event: "rules_load_failed", outcome: "error", error_message: rulesErr.message });
    return jsonResponse({ error: "Failed to load alert rules" }, 500);
  }

  const activeRules = (rules ?? []) as AlertRule[];
  if (activeRules.length === 0) {
    t.log({ event: "no_rules", outcome: "success", organization_id: organizationId });
    return jsonResponse({ ok: true, organization_id: organizationId, message: "No active alert rules" });
  }

  // ── Load facilities ──
  const cap = Math.min(Math.max(Number(body.max_facilities) || 50, 1), 100);
  const facilities = (await loadFacilitiesForOrganization(admin, organizationId)).slice(0, cap);

  let alertsInserted = 0;
  let rulesEvaluated = 0;

  // ── Evaluate each facility against all rules ──
  for (const fac of facilities) {
    const kpi = await computeKpiForFacilityIds(admin, organizationId, [fac]);

    for (const rule of activeRules) {
      rulesEvaluated++;

      // Security: only evaluate known metric domains
      if (!ALLOWED_METRIC_DOMAINS.has(rule.metric_domain)) continue;

      const value = resolvePath(kpi as unknown as Record<string, unknown>, rule.metric_domain);
      if (value == null) continue; // metric not available for this facility

      const triggered = evaluateCondition(
        value,
        rule.condition_op,
        Number(rule.condition_value),
        rule.condition_value_upper != null ? Number(rule.condition_value_upper) : null,
      );

      if (!triggered) continue;

      // Build alert from template
      const templateVars: Record<string, string | number> = {
        facility_name: fac.name ?? fac.id.slice(0, 8),
        facility_id: fac.id,
        value,
        formatted_value: typeof value === "number" && rule.metric_domain.includes("Cents")
          ? (value / 100).toLocaleString()
          : String(value),
      };

      const title = fillTemplate(rule.alert_title_template, templateVars);

      // Deduplicate: don't create if an identical unresolved alert exists
      const { data: dup } = await admin
        .from("exec_alerts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("facility_id", fac.id)
        .eq("title", title)
        .is("deleted_at", null)
        .is("resolved_at", null)
        .maybeSingle();

      if (dup) continue;

      // Compute dynamic score
      const score = rule.severity_weight * rule.impact_weight * recencyFactor();

      const alertBody = rule.alert_body_template
        ? fillTemplate(rule.alert_body_template, templateVars)
        : null;

      const deepLink = rule.deep_link_template
        ? fillTemplate(rule.deep_link_template, templateVars)
        : null;

      const { error: insertErr } = await admin.from("exec_alerts").insert({
        organization_id: organizationId,
        facility_id: fac.id,
        source_module: rule.source_module,
        severity: rule.severity,
        title,
        body: alertBody,
        deep_link_path: deepLink,
        score,
        category: rule.category,
        why_it_matters: rule.why_it_matters,
        source_metric_code: rule.metric_domain,
        current_value_json: { value, metric: rule.metric_domain },
        threshold_json: { op: rule.condition_op, value: Number(rule.condition_value) },
      });

      if (!insertErr) alertsInserted++;
    }
  }

  t.log({
    event: "complete",
    outcome: "success",
    facilities_evaluated: facilities.length,
    rules_count: activeRules.length,
    rules_evaluated: rulesEvaluated,
    alerts_inserted: alertsInserted,
  });

  return jsonResponse({
    ok: true,
    organization_id: organizationId,
    facilities_evaluated: facilities.length,
    rules_count: activeRules.length,
    rules_evaluated: rulesEvaluated,
    alerts_inserted: alertsInserted,
  });
});
