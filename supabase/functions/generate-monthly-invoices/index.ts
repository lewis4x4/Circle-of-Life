/**
 * POST { facility_id, billing_year, billing_month }
 * Auth: `x-cron-secret` must equal env GENERATE_MONTHLY_INVOICES_SECRET (trusted scheduler/cron).
 * Uses service role to insert drafts; idempotent via unique index on (facility_id, resident_id, period_start).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildMonthlyInvoicePreview,
  persistMonthlyInvoicesFromPreview,
} from "../_shared/billing/generate-monthly-invoices.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("GENERATE_MONTHLY_INVOICES_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: {
    facility_id?: string;
    billing_year?: number;
    billing_month?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const facilityId = body.facility_id;
  const billingYear = body.billing_year;
  const billingMonth = body.billing_month;
  if (
    !facilityId ||
    typeof facilityId !== "string" ||
    typeof billingYear !== "number" ||
    typeof billingMonth !== "number" ||
    billingMonth < 1 ||
    billingMonth > 12
  ) {
    return jsonResponse(
      { error: "facility_id (uuid), billing_year, billing_month (1–12) required" },
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const previewResult = await buildMonthlyInvoicePreview(admin, {
    facilityId,
    billingYear,
    billingMonth,
  });

  if (previewResult.error && previewResult.preview.length === 0) {
    return jsonResponse(
      {
        ok: false,
        message: previewResult.error,
        created: 0,
        skipped_duplicates: 0,
      },
      422,
    );
  }

  const persist = await persistMonthlyInvoicesFromPreview(admin, {
    facilityId,
    billingYear,
    billingMonth,
    preview: previewResult.preview,
    periodStart: previewResult.periodStart,
    periodEnd: previewResult.periodEnd,
    dueDate: previewResult.dueDate,
  });

  return jsonResponse({
    ok: true,
    billing_label: previewResult.billingLabel,
    created: persist.createdCount,
    skipped_duplicates: persist.skippedDuplicates,
    preview_count: previewResult.preview.length,
    warning: previewResult.error,
  });
});
