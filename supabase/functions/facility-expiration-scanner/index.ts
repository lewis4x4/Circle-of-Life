/**
 * Daily scan of facility document vault expirations (Facility Admin Portal).
 * POST — Auth: `x-cron-secret` = `FACILITY_EXPIRATION_SCANNER_SECRET`.
 * Compares `facility_documents.expiration_date` to per-document `alert_yellow_days` / `alert_red_days`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

Deno.serve(async (req) => {
  const t = withTiming("facility-expiration-scanner");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("FACILITY_EXPIRATION_SCANNER_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const today = new Date();

  const { data: docs, error: docErr } = await admin
    .from("facility_documents")
    .select(
      "id, facility_id, organization_id, document_name, expiration_date, alert_yellow_days, alert_red_days",
    )
    .is("deleted_at", null)
    .not("expiration_date", "is", null)
    .limit(5000);

  if (docErr) {
    t.log({ event: "error", outcome: "error", error_message: docErr.message });
    return jsonResponse({ error: "Query failed" }, 500);
  }

  const findings: {
    document_id: string;
    facility_id: string;
    document_name: string | null;
    severity: "red" | "yellow";
    days_to_expiration: number;
  }[] = [];

  for (const doc of docs ?? []) {
    try {
      const exp = doc.expiration_date as string;
      const expDate = new Date(`${exp}T12:00:00.000Z`);
      const daysTo = Math.ceil((expDate.getTime() - today.getTime()) / 86_400_000);
      const yellowDays = Number(doc.alert_yellow_days ?? 60);
      const redDays = Number(doc.alert_red_days ?? 30);

      let severity: "red" | "yellow" | null = null;
      if (daysTo <= 0 || daysTo <= redDays) severity = "red";
      else if (daysTo <= yellowDays) severity = "yellow";

      if (severity) {
        findings.push({
          document_id: doc.id as string,
          facility_id: doc.facility_id as string,
          document_name: (doc.document_name as string) ?? null,
          severity,
          days_to_expiration: daysTo,
        });
      }
    } catch (e) {
      t.log({
        event: "row_skipped",
        outcome: "error",
        error_message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  t.log({
    event: "complete",
    outcome: "success",
    documents_scanned: docs?.length ?? 0,
    findings: findings.length,
  });

  return jsonResponse({
    ok: true,
    scanned_at: today.toISOString(),
    documents_with_expiration: docs?.length ?? 0,
    findings_count: findings.length,
    findings: findings.slice(0, 200),
  });
});
