/**
 * Daily AR aging automation (spec 16-billing — `ar-aging-check`).
 * Marks past-due open invoices as `overdue` so AR aging UI and collections align.
 *
 * POST body (optional): `{ "facility_id"?: uuid, "organization_id"?: uuid }`
 * Auth: `x-cron-secret` must equal env `AR_AGING_CHECK_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

Deno.serve(async (req) => {
  const t = withTiming("ar-aging-check");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("AR_AGING_CHECK_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let body: { facility_id?: string; organization_id?: string } = {};
  try {
    if (req.headers.get("content-length") !== "0") {
      body = (await req.json()) as typeof body;
    }
  } catch {
    body = {};
  }

  const today = new Date().toISOString().slice(0, 10);

  let q = admin
    .from("invoices")
    .select("id, facility_id, organization_id, due_date, status")
    .is("deleted_at", null)
    .is("voided_at", null)
    .gt("balance_due", 0)
    .in("status", ["sent", "partial"])
    .lt("due_date", today)
    .limit(2000);

  if (body.facility_id) q = q.eq("facility_id", body.facility_id);
  if (body.organization_id) q = q.eq("organization_id", body.organization_id);

  const { data: rows, error } = await q;
  if (error) {
    t.log({ event: "error", outcome: "error", error_message: error.message });
    return jsonResponse({ error: "Query failed" }, 500);
  }

  const ids = (rows ?? []).map((r) => r.id);
  let updated = 0;
  if (ids.length > 0) {
    const { data: updatedRows, error: upErr } = await admin
      .from("invoices")
      .update({ status: "overdue", updated_at: new Date().toISOString() })
      .in("id", ids)
      .select("id");
    if (upErr) {
      t.log({ event: "error", outcome: "error", error_message: upErr.message });
      return jsonResponse({ error: "Update failed" }, 500);
    }
    updated = updatedRows?.length ?? 0;
  }

  t.log({
    event: "complete",
    outcome: "success",
    invoices_scanned: ids.length,
    marked_overdue: updated,
  });

  return jsonResponse({
    ok: true,
    due_before: today,
    scanned: ids.length,
    marked_overdue: updated,
  });
});
