/**
 * POST body (choose one scope):
 * - Single facility: `{ "facility_id", "billing_year"?, "billing_month"? }`
 * - Organization (all active facilities): `{ "organization_id", "billing_year"?, "billing_month"?, "max_facilities"? }`
 *
 * When `billing_year` / `billing_month` are both omitted, uses `getNextBillingMonth()` (same rule as admin: after the 25th, next calendar month).
 *
 * Auth: `x-cron-secret` must equal env GENERATE_MONTHLY_INVOICES_SECRET (trusted scheduler/cron).
 * Uses service role to insert drafts; idempotent per facility + resident + `period_start` (migration 071).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildMonthlyInvoicePreview,
  getNextBillingMonth,
  listActiveFacilitiesForOrganization,
  monthLabel,
  persistMonthlyInvoicesFromPreview,
} from "../_shared/billing/generate-monthly-invoices.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Period = { year: number; month: number };

function resolveBillingPeriod(body: {
  billing_year?: number;
  billing_month?: number;
}): Period | { error: string } {
  const hasY = typeof body.billing_year === "number";
  const hasM = typeof body.billing_month === "number";
  if (hasY !== hasM) {
    return {
      error: "billing_year and billing_month must both be set or both omitted (omit both to use the next billing month).",
    };
  }
  if (hasY && hasM) {
    if (body.billing_month! < 1 || body.billing_month! > 12) {
      return { error: "billing_month must be 1–12" };
    }
    return { year: body.billing_year!, month: body.billing_month! };
  }
  return getNextBillingMonth();
}

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
    organization_id?: string;
    billing_year?: number;
    billing_month?: number;
    max_facilities?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const period = resolveBillingPeriod(body);
  if ("error" in period) {
    return jsonResponse({ error: period.error }, 400);
  }
  const { year: billingYear, month: billingMonth } = period;

  const facilityId = body.facility_id;
  const organizationId = body.organization_id;

  if (facilityId && organizationId) {
    return jsonResponse(
      { error: "Send only one of facility_id or organization_id, not both." },
      400,
    );
  }

  if (!facilityId && !organizationId) {
    return jsonResponse(
      { error: "Provide facility_id (single site) or organization_id (all active facilities in org)." },
      400,
    );
  }

  if (facilityId && !UUID_RE.test(facilityId)) {
    return jsonResponse({ error: "facility_id must be a UUID" }, 400);
  }
  if (organizationId && !UUID_RE.test(organizationId)) {
    return jsonResponse({ error: "organization_id must be a UUID" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  if (facilityId) {
    return await runSingleFacility(admin, {
      facilityId,
      billingYear,
      billingMonth,
    });
  }

  const maxCap = 500;
  const maxFacilities = Math.min(
    typeof body.max_facilities === "number" && body.max_facilities > 0
      ? Math.floor(body.max_facilities)
      : 100,
    maxCap,
  );

  let facilities: { id: string; name: string }[];
  try {
    facilities = await listActiveFacilitiesForOrganization(admin, organizationId!);
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Could not list facilities" },
      500,
    );
  }

  const truncated = facilities.length > maxFacilities;
  const slice = facilities.slice(0, maxFacilities);

  type FacilityRow = {
    facility_id: string;
    facility_name: string;
    outcome: "success" | "blocked" | "error";
    created: number;
    skipped_duplicates: number;
    preview_count: number;
    billing_label: string;
    warning: string | null;
    detail?: string;
  };

  const rows: FacilityRow[] = [];
  let totalCreated = 0;
  let totalSkippedDup = 0;

  for (const f of slice) {
    try {
      const previewResult = await buildMonthlyInvoicePreview(admin, {
        facilityId: f.id,
        billingYear,
        billingMonth,
      });

      if (previewResult.error && previewResult.preview.length === 0) {
        rows.push({
          facility_id: f.id,
          facility_name: f.name,
          outcome: "blocked",
          created: 0,
          skipped_duplicates: 0,
          preview_count: 0,
          billing_label: previewResult.billingLabel,
          warning: null,
          detail: previewResult.error,
        });
        continue;
      }

      const persist = await persistMonthlyInvoicesFromPreview(admin, {
        facilityId: f.id,
        billingYear,
        billingMonth,
        preview: previewResult.preview,
        periodStart: previewResult.periodStart,
        periodEnd: previewResult.periodEnd,
        dueDate: previewResult.dueDate,
      });

      totalCreated += persist.createdCount;
      totalSkippedDup += persist.skippedDuplicates;

      rows.push({
        facility_id: f.id,
        facility_name: f.name,
        outcome: "success",
        created: persist.createdCount,
        skipped_duplicates: persist.skippedDuplicates,
        preview_count: previewResult.preview.length,
        billing_label: previewResult.billingLabel,
        warning: previewResult.error,
      });
    } catch (e) {
      rows.push({
        facility_id: f.id,
        facility_name: f.name,
        outcome: "error",
        created: 0,
        skipped_duplicates: 0,
        preview_count: 0,
        billing_label: monthLabel(billingYear, billingMonth),
        warning: null,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const errors = rows.filter((r) => r.outcome === "error").length;
  const blocked = rows.filter((r) => r.outcome === "blocked").length;

  return jsonResponse({
    ok: errors === 0,
    mode: "organization",
    organization_id: organizationId,
    billing_year: billingYear,
    billing_month: billingMonth,
    billing_label: monthLabel(billingYear, billingMonth),
    facility_count: facilities.length,
    facilities_processed: rows.length,
    max_facilities,
    truncated,
    facilities: rows,
    totals: {
      created: totalCreated,
      skipped_duplicates: totalSkippedDup,
      outcomes_error: errors,
      outcomes_blocked: blocked,
      outcomes_success: rows.filter((r) => r.outcome === "success").length,
    },
  });
});

async function runSingleFacility(
  admin: ReturnType<typeof createClient>,
  params: { facilityId: string; billingYear: number; billingMonth: number },
) {
  const { facilityId, billingYear, billingMonth } = params;

  const previewResult = await buildMonthlyInvoicePreview(admin, {
    facilityId,
    billingYear,
    billingMonth,
  });

  if (previewResult.error && previewResult.preview.length === 0) {
    return jsonResponse(
      {
        ok: false,
        mode: "facility",
        message: previewResult.error,
        created: 0,
        skipped_duplicates: 0,
        billing_label: previewResult.billingLabel,
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
    mode: "facility",
    billing_label: previewResult.billingLabel,
    billing_year: billingYear,
    billing_month: billingMonth,
    created: persist.createdCount,
    skipped_duplicates: persist.skippedDuplicates,
    preview_count: previewResult.preview.length,
    warning: previewResult.error,
  });
}
