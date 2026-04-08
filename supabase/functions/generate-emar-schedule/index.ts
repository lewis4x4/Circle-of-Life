/**
 * Nightly eMAR schedule generation (spec 04 — `generate-emar-schedule`).
 * For active scheduled medications with `scheduled_times`, inserts `emar_records` for the next N days
 * when a row for the same (medication, scheduled_time) does not already exist.
 *
 * POST body (optional): `{ "facility_id"?: uuid, "organization_id"?: uuid, "days_ahead"?: number }`
 * Auth: `x-cron-secret` must equal env `GENERATE_EMAR_SCHEDULE_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTimeToUtcHours(t: string): { h: number; m: number; s: number } {
  const parts = t.split(":");
  return {
    h: Number(parts[0] ?? 0),
    m: Number(parts[1] ?? 0),
    s: Number(parts[2] ?? 0),
  };
}

Deno.serve(async (req) => {
  const t = withTiming("generate-emar-schedule");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("GENERATE_EMAR_SCHEDULE_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let body: { facility_id?: string; organization_id?: string; days_ahead?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const daysAhead = Math.min(Math.max(Number(body.days_ahead) || 7, 1), 14);

  let medQuery = admin
    .from("resident_medications")
    .select(
      "id, resident_id, facility_id, organization_id, frequency, scheduled_times",
    )
    .eq("status", "active")
    .is("deleted_at", null)
    .not("frequency", "eq", "prn")
    .limit(500);

  if (body.facility_id) {
    if (!UUID_RE.test(body.facility_id)) return jsonResponse({ error: "Invalid facility_id" }, 400);
    medQuery = medQuery.eq("facility_id", body.facility_id);
  }
  if (body.organization_id) {
    if (!UUID_RE.test(body.organization_id)) return jsonResponse({ error: "Invalid organization_id" }, 400);
    medQuery = medQuery.eq("organization_id", body.organization_id);
  }

  const { data: medications, error: medErr } = await medQuery;
  if (medErr) {
    t.log({ event: "error", outcome: "error", error_message: medErr.message });
    return jsonResponse({ error: "Query failed" }, 500);
  }

  let inserted = 0;
  const now = new Date();

  for (const med of medications ?? []) {
    const times = med.scheduled_times as string[] | null;
    if (!times || times.length === 0) continue;

    for (let d = 0; d < daysAhead; d++) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
      for (const timeStr of times) {
        const { h, m, s } = parseTimeToUtcHours(timeStr);
        const scheduled = new Date(
          Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, s),
        );

        const { data: existing } = await admin
          .from("emar_records")
          .select("id")
          .eq("resident_medication_id", med.id)
          .eq("scheduled_time", scheduled.toISOString())
          .is("deleted_at", null)
          .maybeSingle();

        if (existing) continue;

        const { error: insErr } = await admin.from("emar_records").insert({
          resident_id: med.resident_id,
          resident_medication_id: med.id,
          facility_id: med.facility_id,
          organization_id: med.organization_id,
          scheduled_time: scheduled.toISOString(),
          status: "scheduled",
          is_prn: false,
        });

        if (!insErr) inserted += 1;
      }
    }
  }

  t.log({ event: "complete", outcome: "success", medications_considered: medications?.length ?? 0, inserted });

  return jsonResponse({
    ok: true,
    days_ahead: daysAhead,
    medications_considered: medications?.length ?? 0,
    inserted,
  });
});
