/**
 * Missed-dose detection (spec 04 — `emar-missed-dose-check`).
 * Finds `emar_records` still `scheduled` whose scheduled time is older than 2 hours and emits
 * `exec_alerts` (source_module `medications`) for operator visibility. Does not mutate eMAR rows
 * (no `missed` status in base enum — alerts drive follow-up).
 *
 * POST body (optional): `{ "facility_id"?: uuid, "organization_id"?: uuid, "max_rows"?: number }`
 * Auth: `x-cron-secret` must equal env `EMAR_MISSED_DOSE_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const t = withTiming("emar-missed-dose-check");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("EMAR_MISSED_DOSE_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let body: { facility_id?: string; organization_id?: string; max_rows?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const maxRows = Math.min(Math.max(Number(body.max_rows) || 100, 1), 500);
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  let q = admin
    .from("emar_records")
    .select("id, organization_id, facility_id, resident_id, scheduled_time")
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .lt("scheduled_time", cutoff)
    .order("scheduled_time", { ascending: true })
    .limit(maxRows);

  if (body.facility_id) {
    if (!UUID_RE.test(body.facility_id)) return jsonResponse({ error: "Invalid facility_id" }, 400);
    q = q.eq("facility_id", body.facility_id);
  }
  if (body.organization_id) {
    if (!UUID_RE.test(body.organization_id)) return jsonResponse({ error: "Invalid organization_id" }, 400);
    q = q.eq("organization_id", body.organization_id);
  }

  const { data: due, error } = await q;
  if (error) {
    t.log({ event: "error", outcome: "error", error_message: error.message });
    return jsonResponse({ error: "Query failed" }, 500);
  }

  let alertsInserted = 0;
  for (const row of due ?? []) {
    const deep = `/caregiver/meds?highlight=${row.id}`;
    const { data: dup } = await admin
      .from("exec_alerts")
      .select("id")
      .eq("organization_id", row.organization_id)
      .eq("deep_link_path", deep)
      .is("deleted_at", null)
      .is("resolved_at", null)
      .maybeSingle();

    if (dup) continue;

    const { error: insErr } = await admin.from("exec_alerts").insert({
      organization_id: row.organization_id,
      facility_id: row.facility_id,
      source_module: "medications",
      severity: "warning",
      title: "Missed medication administration",
      body: `eMAR record ${row.id} scheduled ${row.scheduled_time} is overdue.`,
      deep_link_path: deep,
    });

    if (!insErr) alertsInserted += 1;
  }

  t.log({
    event: "complete",
    outcome: "success",
    overdue_scheduled_rows: due?.length ?? 0,
    alerts_inserted: alertsInserted,
  });

  return jsonResponse({
    ok: true,
    overdue_scheduled_rows: due?.length ?? 0,
    alerts_inserted: alertsInserted,
  });
});
