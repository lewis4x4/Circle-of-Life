import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/types/database";
import {
  buildCapexForecast,
  buildCostToServeForecast,
  buildDsoForecast,
  type CapexDueAssetRow,
  type CapexFacilityRow,
  type CapexSummary,
  type CostToServeFacilityRow,
  type CostToServeSummary,
  type DsoFacilityRow,
  type DsoSummary,
  type ForecastFacility,
  type ForecastFacilityAsset,
} from "@/lib/finance/forecast";

export type ForecastSnapshot = {
  facilities: ForecastFacility[];
  dso: {
    summary: DsoSummary;
    rows: DsoFacilityRow[];
  };
  cost: {
    summary: CostToServeSummary;
    rows: CostToServeFacilityRow[];
  };
  capex: {
    summary: CapexSummary;
    rows: CapexFacilityRow[];
    dueSoon: CapexDueAssetRow[];
  };
};

type FacilityAssetQueryRow = ForecastFacilityAsset & {
  deleted_at?: string | null;
};

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function loadFinanceForecastData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
): Promise<ForecastSnapshot> {
  const billedStart = daysAgoIso(90);
  const laborStart = daysAgoIso(30);

  let facilitiesQuery = supabase
    .from("facilities")
    .select("id, name, entity_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name");

  let openInvoicesQuery = supabase
    .from("invoices")
    .select("id, facility_id, resident_id, invoice_date, due_date, total, balance_due, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["sent", "partial", "overdue"]);

  let billedInvoicesQuery = supabase
    .from("invoices")
    .select("id, facility_id, resident_id, invoice_date, due_date, total, balance_due, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("invoice_date", billedStart)
    .in("status", ["sent", "paid", "partial", "overdue"]);

  let paymentsQuery = supabase
    .from("payments")
    .select("facility_id, payment_date, amount")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("payment_date", billedStart);

  let trustEntriesQuery = supabase
    .from("trust_account_entries")
    .select("resident_id, facility_id, entry_date, balance_after_cents")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("entry_date", { ascending: false });

  let timeRecordsQuery = supabase
    .from("time_records")
    .select("staff_id, facility_id, clock_in, actual_hours, regular_hours, overtime_hours")
    .eq("organization_id", organizationId)
    .eq("approved", true)
    .is("deleted_at", null)
    .gte("clock_in", `${laborStart}T00:00:00.000Z`);

  let staffRatesQuery = supabase
    .from("staff")
    .select("id, facility_id, hourly_rate, overtime_rate, employment_status, staff_role")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  let vendorInvoicesQuery = supabase
    .from("vendor_invoices")
    .select("facility_id, invoice_date, status, total_cents")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("invoice_date", laborStart)
    .in("status", ["submitted", "approved", "matched", "paid"]);

  let residentsQuery = supabase
    .from("residents")
    .select("id, facility_id, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  let facilityAssetsQuery = supabase
    .from("facility_assets" as never)
    .select(
      "id, facility_id, asset_type, name, status, lifecycle_replace_by, replacement_cost_estimate_cents, deleted_at",
    )
    .eq("organization_id" as never, organizationId as never)
    .order("lifecycle_replace_by" as never, { ascending: true });

  if (facilityId) {
    facilitiesQuery = facilitiesQuery.eq("id", facilityId);
    openInvoicesQuery = openInvoicesQuery.eq("facility_id", facilityId);
    billedInvoicesQuery = billedInvoicesQuery.eq("facility_id", facilityId);
    paymentsQuery = paymentsQuery.eq("facility_id", facilityId);
    trustEntriesQuery = trustEntriesQuery.eq("facility_id", facilityId);
    timeRecordsQuery = timeRecordsQuery.eq("facility_id", facilityId);
    staffRatesQuery = staffRatesQuery.eq("facility_id", facilityId);
    vendorInvoicesQuery = vendorInvoicesQuery.eq("facility_id", facilityId);
    residentsQuery = residentsQuery.eq("facility_id", facilityId);
    facilityAssetsQuery = facilityAssetsQuery.eq("facility_id" as never, facilityId as never);
  }

  const [
    facilitiesRes,
    openInvoicesRes,
    billedInvoicesRes,
    paymentsRes,
    trustEntriesRes,
    timeRecordsRes,
    staffRatesRes,
    vendorInvoicesRes,
    residentsRes,
    facilityAssetsRes,
  ] = await Promise.all([
    facilitiesQuery,
    openInvoicesQuery,
    billedInvoicesQuery,
    paymentsQuery,
    trustEntriesQuery,
    timeRecordsQuery,
    staffRatesQuery,
    vendorInvoicesQuery,
    residentsQuery,
    facilityAssetsQuery,
  ]);

  const responses = [
    facilitiesRes,
    openInvoicesRes,
    billedInvoicesRes,
    paymentsRes,
    trustEntriesRes,
    timeRecordsRes,
    staffRatesRes,
    vendorInvoicesRes,
    residentsRes,
    facilityAssetsRes,
  ];

  for (const response of responses) {
    if (response.error) throw response.error;
  }

  const facilities = (facilitiesRes.data ?? []) as ForecastFacility[];
  const openInvoices = (openInvoicesRes.data ?? []) as Array<
    Pick<Tables<"invoices">, "id" | "facility_id" | "resident_id" | "invoice_date" | "due_date" | "total" | "balance_due" | "status">
  >;
  const billedInvoices = (billedInvoicesRes.data ?? []) as Array<
    Pick<Tables<"invoices">, "id" | "facility_id" | "resident_id" | "invoice_date" | "due_date" | "total" | "balance_due" | "status">
  >;
  const payments = (paymentsRes.data ?? []) as Array<Pick<Tables<"payments">, "facility_id" | "payment_date" | "amount">>;
  const trustEntries = (trustEntriesRes.data ?? []) as Array<
    Pick<Tables<"trust_account_entries">, "resident_id" | "facility_id" | "entry_date" | "balance_after_cents">
  >;
  const timeRecords = (timeRecordsRes.data ?? []) as Array<
    Pick<Tables<"time_records">, "staff_id" | "facility_id" | "clock_in" | "actual_hours" | "regular_hours" | "overtime_hours">
  >;
  const staffRates = (staffRatesRes.data ?? []) as Array<
    Pick<Tables<"staff">, "id" | "facility_id" | "hourly_rate" | "overtime_rate" | "employment_status" | "staff_role">
  >;
  const vendorInvoices = (vendorInvoicesRes.data ?? []) as Array<
    Pick<Tables<"vendor_invoices">, "facility_id" | "invoice_date" | "status" | "total_cents">
  >;
  const residents = (residentsRes.data ?? []) as Array<Pick<Tables<"residents">, "id" | "facility_id" | "status">>;
  const facilityAssets = ((facilityAssetsRes.data ?? []) as unknown as FacilityAssetQueryRow[]).filter(
    (asset) => !asset.deleted_at,
  );

  return {
    facilities,
    dso: buildDsoForecast({
      facilities,
      openInvoices,
      billedInvoices90d: billedInvoices,
      payments90d: payments,
      trustEntries,
    }),
    cost: buildCostToServeForecast({
      facilities,
      residents,
      timeRecords30d: timeRecords,
      staffRates,
      vendorInvoices30d: vendorInvoices,
    }),
    capex: buildCapexForecast({
      facilities,
      assets: facilityAssets,
    }),
  };
}
