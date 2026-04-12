/**
 * Observation escalation engine — cron-triggered (every 15 min)
 *
 * Catches overdue resident observation tasks and escalates them:
 *   grace_ends_at passed           -> overdue
 *   grace_ends_at + 30 min passed  -> critically_overdue (level-1)
 *   grace_ends_at + 120 min passed -> missed             (level-2)
 *
 * POST body: { organization_id: uuid }
 * Auth: x-cron-secret == OBSERVATION_ESCALATION_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = ["completed_on_time", "completed_late", "missed", "excused"];

function classify(graceEndsAt: string, now: Date): string {
  const ms = now.getTime() - new Date(graceEndsAt).getTime();
  if (ms >= 120 * 60_000) return "missed";
  if (ms >= 30 * 60_000) return "critically_overdue";
  return "overdue";
}

Deno.serve(async (req) => {
  const t = withTiming("observation-escalation-engine");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OBSERVATION_ESCALATION_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { organization_id?: string };
  try { body = (await req.json()) as typeof body; } catch { return jsonResponse({ error: "Invalid JSON body" }, 400, origin); }
  const orgId = body.organization_id?.trim();
  if (!orgId || !UUID_RE.test(orgId)) return jsonResponse({ error: "organization_id (uuid) is required" }, 400, origin);

  // 1. Query overdue tasks
  const { data: rows, error: qErr } = await admin
    .from("resident_observation_tasks")
    .select("id, facility_id, organization_id, resident_id, status, grace_ends_at, facilities!inner(name)")
    .eq("organization_id", orgId)
    .not("status", "in", `(${TERMINAL.join(",")})`)
    .lt("grace_ends_at", new Date().toISOString())
    .is("deleted_at", null);

  if (qErr) { t.log({ event: "query_failed", outcome: "error", error_message: qErr.message }); return jsonResponse({ error: "Failed to query tasks" }, 500, origin); }

  const now = new Date();
  let escalated = 0, missedCount = 0;

  // deno-lint-ignore no-explicit-any
  for (const r of (rows ?? []) as any[]) {
    const facName = r.facilities?.name ?? "Unknown";
    const newStatus = classify(r.grace_ends_at, now);
    if (newStatus === r.status) continue;

    // 2. Update task status
    await admin.from("resident_observation_tasks").update({ status: newStatus, updated_at: now.toISOString() }).eq("id", r.id);

    // 3. Critically overdue -> level-1 escalation
    if (newStatus === "critically_overdue") {
      const { data: dup } = await admin.from("resident_observation_escalations").select("id").eq("observation_task_id", r.id).is("resolved_at", null).maybeSingle();
      if (!dup) {
        await admin.from("resident_observation_escalations").insert({ organization_id: orgId, facility_id: r.facility_id, observation_task_id: r.id, resident_id: r.resident_id, escalation_level: 1, escalation_type: "auto_overdue" });
        const title = `Critically overdue observation at ${facName}`;
        const { data: ad } = await admin.from("exec_alerts").select("id").eq("organization_id", orgId).eq("facility_id", r.facility_id).eq("title", title).is("resolved_at", null).is("deleted_at", null).maybeSingle();
        if (!ad) await admin.from("exec_alerts").insert({ organization_id: orgId, facility_id: r.facility_id, source_module: "resident_assurance", severity: "warning", title, body: `Task ${r.id} critically overdue (>30 min past grace).` });
        escalated++;
      }
    }

    // 4. Missed -> level-2 escalation + watch severity boost
    if (newStatus === "missed") {
      missedCount++;
      const { data: dup } = await admin.from("resident_observation_escalations").select("id").eq("observation_task_id", r.id).eq("escalation_level", 2).is("resolved_at", null).maybeSingle();
      if (!dup) {
        let sw = 1;
        if (r.resident_id) {
          const { data: w } = await admin.from("resident_watch_instances").select("id").eq("resident_id", r.resident_id).is("ended_at", null).is("deleted_at", null).maybeSingle();
          if (w) sw = 2;
        }
        await admin.from("resident_observation_escalations").insert({ organization_id: orgId, facility_id: r.facility_id, observation_task_id: r.id, resident_id: r.resident_id, escalation_level: 2, escalation_type: "auto_overdue", severity_weight: sw });
        const title = `Missed observation at ${facName}`;
        const { data: ad } = await admin.from("exec_alerts").select("id").eq("organization_id", orgId).eq("facility_id", r.facility_id).eq("title", title).is("resolved_at", null).is("deleted_at", null).maybeSingle();
        if (!ad) await admin.from("exec_alerts").insert({ organization_id: orgId, facility_id: r.facility_id, source_module: "resident_assurance", severity: "critical", title, body: `Task ${r.id} missed (>120 min).${sw > 1 ? " Active watch — doubled severity." : ""}`, score: sw > 1 ? 20 : 10 });
        escalated++;
      }
    }
  }

  t.log({ event: "complete", outcome: "success", organization_id: orgId, tasks_evaluated: (rows ?? []).length, escalated, missed_count: missedCount });
  return jsonResponse({ ok: true, tasks_evaluated: (rows ?? []).length, escalated, missed_count: missedCount }, 200, origin);
});
