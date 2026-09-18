/**
 * Cron: records one `census_daily_log` row per live facility for one operating
 * day — the midnight census that resident-days are counted on (COL-414).
 *
 * The table has existed since migration 007 with no writer, which is why the
 * executive incident rate divides by one day's census multiplied by the window
 * instead of by the resident-days actually served. This job supplies the days.
 *
 * Auth: `x-cron-secret` must equal env `DAILY_CENSUS_LOG_SECRET`.
 *
 * Body (all optional): `{ "organization_id"?: uuid, "log_date"?: "YYYY-MM-DD", "force"?: true }`.
 * No `organization_id` records every organization. `log_date` or `force` is an
 * explicit instruction and bypasses the midnight-hour gate; the database still
 * refuses any day it can no longer observe.
 *
 * Must run before `exec-kpi-snapshot` on the same day, or the newest day of the
 * incident-rate window has no census recorded against it yet.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { decideCensusRun, parseRequestedLogDate } from "./operating-day.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const t = withTiming("daily-census-log");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("DAILY_CENSUS_LOG_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return jsonResponse({ error: "Server configuration error" }, 503);
  }

  let body: { organization_id?: unknown; log_date?: unknown; force?: unknown } = {};
  try {
    if (req.headers.get("content-length") !== "0") {
      body = (await req.json()) as typeof body;
    }
  } catch {
    body = {};
  }

  const organizationId = body.organization_id;
  if (organizationId !== undefined && organizationId !== null) {
    if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
      return jsonResponse({ error: "organization_id must be a uuid" }, 400);
    }
  }

  const requestedLogDate = parseRequestedLogDate(body.log_date);
  if (!requestedLogDate.ok) {
    return jsonResponse({ error: requestedLogDate.error }, 400);
  }

  const decision = decideCensusRun({
    now: new Date(),
    requestedLogDate: requestedLogDate.value,
    force: body.force === true,
  });

  // A gated invocation did its job by declining. Reporting it as an error would
  // page someone every night for the half of the schedule that must not run.
  if (!decision.run) {
    t.log({ event: "skipped", outcome: "success", error_message: decision.reason });
    return jsonResponse({ ok: true, outcome: "skipped", reason: decision.reason });
  }

  const supabase = createClient(url, serviceKey);

  t.log({
    event: "start",
    organization_id: typeof organizationId === "string" ? organizationId : null,
    reason: decision.reason,
  });

  const { data, error } = await supabase.rpc("record_census_daily_log", {
    p_organization_id: typeof organizationId === "string" ? organizationId : null,
    p_log_date: decision.logDate,
  });

  if (error) {
    t.log({ event: "error", outcome: "error", error_message: error.message, error_code: error.code });
    return jsonResponse({ error: "Census write failed" }, 500);
  }

  const summary = (data ?? {}) as {
    log_date?: string;
    facilities_recorded?: number;
    residents_in_census?: number;
  };

  t.log({
    event: "complete",
    outcome: "success",
    log_date: summary.log_date ?? null,
    facilities_recorded: summary.facilities_recorded ?? 0,
  });

  // Counts only. No resident is named, here or in the log line above.
  return jsonResponse({
    ok: true,
    outcome: "recorded",
    log_date: summary.log_date ?? null,
    facilities_recorded: summary.facilities_recorded ?? 0,
    residents_in_census: summary.residents_in_census ?? 0,
  });
});
