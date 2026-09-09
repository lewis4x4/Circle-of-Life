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
  billingPeriodError,
  buildMonthlyInvoicePreview,
  getNextBillingMonth,
  listActiveFacilitiesForOrganization,
  monthLabel,
  MonthlyInvoicePersistenceError,
  persistMonthlyInvoicesFromPreview,
} from "../_shared/billing/generate-monthly-invoices.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Period = { year: number; month: number };

function resolveBillingPeriod(body: {
  billing_year?: number;
  billing_month?: number;
}): Period | { error: string } {
  const hasY = body.billing_year !== undefined;
  const hasM = body.billing_month !== undefined;
  if (hasY !== hasM) {
    return {
      error: "billing_year and billing_month must both be set or both omitted (omit both to use the next billing month).",
    };
  }
  if (hasY && hasM) {
    const error = billingPeriodError(body.billing_year, body.billing_month);
    if (error) return { error };
    return { year: body.billing_year!, month: body.billing_month! };
  }
  return getNextBillingMonth();
}

Deno.serve(async (req) => {
  const t = withTiming("generate-monthly-invoices");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = Deno.env.get("GENERATE_MONTHLY_INVOICES_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "JSON object body required" }, 400);
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

  t.log({ event: "start", organization_id: organizationId, billing_year: billingYear, billing_month: billingMonth });

  let facilities: { id: string; name: string }[];
  try {
    facilities = await listActiveFacilitiesForOrganization(admin, organizationId!);
  } catch {
    t.log({ event: "error", outcome: "error", error_message: "Could not list facilities" });
    return jsonResponse({ ok: false, complete: false, partial: false, outcome_unknown: false, created: 0, error: "Could not list facilities" }, 500);
  }

  const truncated = facilities.length > maxFacilities;
  const slice = facilities.slice(0, maxFacilities);

  type FacilityRow = {
    facility_id: string;
    facility_name: string;
    outcome: "success" | "partial" | "blocked" | "error";
    complete: boolean;
    partial: boolean;
    outcome_unknown: boolean;
    unresolved_invoice_number?: string;
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
    let previewCount = 0;
    try {
      const previewResult = await buildMonthlyInvoicePreview(admin, {
        facilityId: f.id,
        billingYear,
        billingMonth,
      });

      previewCount = previewResult.preview.length;
      if (previewResult.error && previewResult.preview.length === 0) {
        rows.push({
          facility_id: f.id,
          facility_name: f.name,
          outcome: "blocked",
          complete: false,
          partial: false,
          outcome_unknown: false,
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
        outcome: previewResult.error ? "partial" : "success",
        complete: previewResult.error === null,
        partial: previewResult.error !== null,
        outcome_unknown: false,
        created: persist.createdCount,
        skipped_duplicates: persist.skippedDuplicates,
        preview_count: previewResult.preview.length,
        billing_label: previewResult.billingLabel,
        warning: previewResult.error,
      });
    } catch (e) {
      const progress = e instanceof MonthlyInvoicePersistenceError ? e : null;
      totalCreated += progress?.createdCount ?? 0;
      totalSkippedDup += progress?.skippedDuplicates ?? 0;
      t.log({ event: "facility_error", outcome: "error", facility_id: f.id,
        error_code: progress ? "MONTHLY_INVOICE_OUTCOME_UNKNOWN" : "MONTHLY_INVOICE_GENERATION_FAILED",
        error_message: "Invoice generation stopped.",
        known_created: progress?.createdCount ?? 0, known_duplicates: progress?.skippedDuplicates ?? 0,
      });
      rows.push({
        facility_id: f.id,
        facility_name: f.name,
        outcome: "error",
        complete: false,
        partial: Boolean(progress && (progress.createdCount > 0 || progress.skippedDuplicates > 0)),
        outcome_unknown: progress?.outcomeUnknown ?? false,
        ...(progress ? { unresolved_invoice_number: progress.unresolvedInvoiceNumber } : {}),
        created: progress?.createdCount ?? 0,
        skipped_duplicates: progress?.skippedDuplicates ?? 0,
        preview_count: previewCount,
        billing_label: monthLabel(billingYear, billingMonth),
        warning: null,
        detail: progress ? "Invoice generation stopped; reconcile the unresolved invoice before retrying." : "Invoice generation failed for this facility",
      });
    }
  }

  const errors = rows.filter((r) => r.outcome === "error").length;
  const blocked = rows.filter((r) => r.outcome === "blocked").length;
  const partial = rows.filter((r) => r.partial).length;
  const unknown = rows.filter((r) => r.outcome_unknown).length;
  const complete = errors === 0 && blocked === 0 && partial === 0 && !truncated;

  t.log({
    event: "org_complete",
    outcome: errors > 0 ? "error" : !complete ? "blocked" : "success",
    organization_id: organizationId,
    invoices_created: totalCreated,
    facilities_processed: rows.length,
    outcomes_error: errors,
    outcomes_blocked: blocked,
    outcomes_partial: partial,
    outcomes_unknown: unknown,
  });

  return jsonResponse({
    ok: complete,
    complete,
    partial: truncated || partial > 0 || (!complete && (totalCreated > 0 || totalSkippedDup > 0)),
    outcome_unknown: unknown > 0,
    mode: "organization",
    organization_id: organizationId,
    billing_year: billingYear,
    billing_month: billingMonth,
    billing_label: monthLabel(billingYear, billingMonth),
    facility_count: facilities.length,
    facilities_processed: rows.length,
    max_facilities: maxFacilities,
    truncated,
    facilities: rows,
    totals: {
      created: totalCreated,
      skipped_duplicates: totalSkippedDup,
      outcomes_error: errors,
      outcomes_blocked: blocked,
      outcomes_partial: partial,
      outcomes_unknown: unknown,
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
        complete: false,
        partial: false,
        outcome_unknown: false,
        mode: "facility",
        message: previewResult.error,
        created: 0,
        skipped_duplicates: 0,
        billing_label: previewResult.billingLabel,
      },
      422,
    );
  }

  let persist;
  try {
    persist = await persistMonthlyInvoicesFromPreview(admin, {
      facilityId,
      billingYear,
      billingMonth,
      preview: previewResult.preview,
      periodStart: previewResult.periodStart,
      periodEnd: previewResult.periodEnd,
      dueDate: previewResult.dueDate,
    });
  } catch (error) {
    if (!(error instanceof MonthlyInvoicePersistenceError)) throw error;
    return jsonResponse({
      ok: false, complete: false, mode: "facility",
      partial: error.createdCount > 0 || error.skippedDuplicates > 0,
      outcome_unknown: true, unresolved_invoice_number: error.unresolvedInvoiceNumber,
      created: error.createdCount, skipped_duplicates: error.skippedDuplicates,
      preview_count: previewResult.preview.length, billing_label: previewResult.billingLabel,
      message: "Invoice generation stopped; reconcile the unresolved invoice before retrying.",
    }, 500);
  }

  return jsonResponse({
    ok: previewResult.error === null,
    complete: previewResult.error === null,
    partial: previewResult.error !== null,
    outcome_unknown: false,
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
