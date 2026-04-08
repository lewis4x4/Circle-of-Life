/**
 * Cron worker for report schedules.
 * Auth: `x-cron-secret` must match REPORT_SCHEDULER_SECRET.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const MAX_BATCH = 100;

function nextRunFromRule(rule: string): Date {
  const now = new Date();
  if (rule === "daily") return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (rule === "monthly") return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (rule === "quarterly" || rule === "quarter-end") {
    return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  }
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

Deno.serve(async (req) => {
  const t = withTiming("report-scheduler");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("REPORT_SCHEDULER_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return jsonResponse({ error: "Server configuration error" }, 503);

  const supabase = createClient(url, serviceRoleKey);
  const nowIso = new Date().toISOString();

  const { data: schedules, error: schedulesErr } = await supabase
    .from("report_schedules")
    .select("id, organization_id, source_type, source_id, recurrence_rule")
    .eq("status", "active")
    .is("deleted_at", null)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(MAX_BATCH);

  if (schedulesErr) {
    t.log({ event: "error", outcome: "error", error_message: "schedule query failed", error_code: schedulesErr.code });
    return jsonResponse({ error: "Database error" }, 500);
  }

  let processed = 0;
  for (const schedule of schedules ?? []) {
    const startedAt = new Date().toISOString();
    const { data: run, error: runErr } = await supabase
      .from("report_runs")
      .insert({
        organization_id: schedule.organization_id,
        source_type: schedule.source_type,
        source_id: schedule.source_id,
        status: "running",
        started_at: startedAt,
        runtime_classification: "scheduled",
      })
      .select("id")
      .single();

    if (runErr || !run?.id) {
      t.log({ event: "run_insert_error", outcome: "error", schedule_id: schedule.id, error_message: runErr?.message ?? "run insert failed" });
      await supabase
        .from("report_schedules")
        .update({ status: "failed", last_error: runErr?.message ?? "run insert failed" })
        .eq("id", schedule.id);
      continue;
    }

    const completedAt = new Date().toISOString();
    const nextRunAt = nextRunFromRule(schedule.recurrence_rule).toISOString();

    const { error: finishRunErr } = await supabase
      .from("report_runs")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", run.id);
    if (finishRunErr) {
      t.log({ event: "run_finish_error", outcome: "error", schedule_id: schedule.id, error_message: finishRunErr.message });
    }

    const { error: scheduleUpdateErr } = await supabase
      .from("report_schedules")
      .update({
        last_run_at: completedAt,
        next_run_at: nextRunAt,
        last_error: null,
      })
      .eq("id", schedule.id);
    if (scheduleUpdateErr) {
      t.log({ event: "schedule_update_error", outcome: "error", schedule_id: schedule.id, error_message: scheduleUpdateErr.message });
    }

    processed += 1;
  }

  t.log({ event: "complete", outcome: "success", processed });

  return jsonResponse({ ok: true, processed });
});
