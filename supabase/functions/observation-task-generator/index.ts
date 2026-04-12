/**
 * Observation task generator (spec 25 — Resident Assurance Engine).
 * Cron-triggered: reads active observation plans + rules, generates upcoming
 * tasks for the next 12 hours, upserting into `resident_observation_tasks`.
 *
 * POST body: `{ "organization_id": uuid }`
 * Auth: `x-cron-secret` must equal env `OBSERVATION_TASK_GENERATOR_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shift windows (hour-of-day, 24h clock)
const SHIFTS = [
  { name: "day", start: 7, end: 15 },
  { name: "evening", start: 15, end: 23 },
  { name: "night", start: 23, end: 31 }, // 31 = next-day 07:00
] as const;

interface PlanRule {
  id: string;
  plan_id: string;
  interval_type: "fixed_minutes" | "per_shift" | "daypart";
  interval_minutes: number | null;
  daypart_start: string | null; // "HH:MM"
  daypart_end: string | null;
  grace_minutes: number;
  organization_id: string;
  entity_id: string;
  facility_id: string;
  resident_id: string;
}

function generateTimestamps(
  rule: PlanRule,
  now: Date,
  horizon: Date,
): Date[] {
  const timestamps: Date[] = [];

  if (rule.interval_type === "fixed_minutes") {
    const interval = (rule.interval_minutes ?? 60) * 60_000;
    let cursor = new Date(Math.ceil(now.getTime() / interval) * interval);
    while (cursor < horizon) {
      timestamps.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + interval);
    }
  } else if (rule.interval_type === "per_shift") {
    for (const shift of SHIFTS) {
      const shiftStart = new Date(now);
      shiftStart.setUTCHours(shift.start % 24, 0, 0, 0);
      if (shift.start >= 24) shiftStart.setUTCDate(shiftStart.getUTCDate() + 1);
      if (shiftStart >= now && shiftStart < horizon) {
        timestamps.push(shiftStart);
      }
    }
  } else if (rule.interval_type === "daypart") {
    const [dStartH, dStartM] = (rule.daypart_start ?? "08:00").split(":").map(Number);
    const [dEndH, dEndM] = (rule.daypart_end ?? "20:00").split(":").map(Number);
    const interval = (rule.interval_minutes ?? 60) * 60_000;

    const daypartStart = new Date(now);
    daypartStart.setUTCHours(dStartH, dStartM, 0, 0);
    const daypartEnd = new Date(now);
    daypartEnd.setUTCHours(dEndH, dEndM, 0, 0);

    let cursor = daypartStart < now ? new Date(Math.ceil(now.getTime() / interval) * interval) : daypartStart;
    while (cursor < horizon && cursor <= daypartEnd) {
      if (cursor >= now) timestamps.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + interval);
    }
  }

  return timestamps;
}

Deno.serve(async (req) => {
  const t = withTiming("observation-task-generator");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OBSERVATION_TASK_GENERATOR_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  let body: { organization_id?: string } = {};
  try { body = (await req.json()) as typeof body; } catch { body = {}; }

  const orgId = body.organization_id;
  if (!orgId || !UUID_RE.test(orgId)) {
    return jsonResponse({ error: "organization_id required" }, 400, origin);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1. Active plans
  const { data: plans, error: plansErr } = await admin
    .from("resident_observation_plans")
    .select("id, resident_id, organization_id, entity_id, facility_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (plansErr) {
    t.log({ event: "plans_query_error", outcome: "error", error_message: plansErr.message });
    return jsonResponse({ error: "Query failed" }, 500, origin);
  }
  if (!plans || plans.length === 0) {
    t.log({ event: "no_active_plans", outcome: "success" });
    return jsonResponse({ ok: true, organization_id: orgId, tasks_generated: 0 }, 200, origin);
  }

  const planIds = plans.map((p) => p.id);
  const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));

  // 2. Active rules
  const { data: rules, error: rulesErr } = await admin
    .from("resident_observation_plan_rules")
    .select("id, plan_id, interval_type, interval_minutes, daypart_start, daypart_end, grace_minutes")
    .in("plan_id", planIds)
    .eq("active", true)
    .is("deleted_at", null);

  if (rulesErr) {
    t.log({ event: "rules_query_error", outcome: "error", error_message: rulesErr.message });
    return jsonResponse({ error: "Query failed" }, 500, origin);
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 12 * 60 * 60_000);
  let tasksGenerated = 0;

  // 3–4. Generate + upsert tasks
  for (const rule of rules ?? []) {
    const plan = planMap[rule.plan_id];
    if (!plan) continue;

    const enrichedRule: PlanRule = { ...rule, ...plan } as PlanRule;
    const slots = generateTimestamps(enrichedRule, now, horizon);

    for (const scheduled of slots) {
      const dueAt = scheduled.toISOString();
      const graceEndsAt = new Date(scheduled.getTime() + (rule.grace_minutes ?? 15) * 60_000).toISOString();

      const { error: upsertErr } = await admin.from("resident_observation_tasks").upsert(
        {
          organization_id: plan.organization_id,
          entity_id: plan.entity_id,
          facility_id: plan.facility_id,
          resident_id: plan.resident_id,
          plan_id: plan.id,
          plan_rule_id: rule.id,
          scheduled_for: dueAt,
          due_at: dueAt,
          grace_ends_at: graceEndsAt,
          status: "upcoming",
        },
        { onConflict: "organization_id,plan_rule_id,scheduled_for", ignoreDuplicates: true },
      );

      if (!upsertErr) tasksGenerated += 1;
    }
  }

  t.log({ event: "complete", outcome: "success", plans: plans.length, rules: rules?.length ?? 0, tasks_generated: tasksGenerated });

  return jsonResponse({ ok: true, organization_id: orgId, tasks_generated: tasksGenerated }, 200, origin);
});
