import { cookies } from "next/headers";

import { BillingArOverviewHero } from "./billing-ar-overview-hero";
import { BillingHubNav } from "./billing-hub-nav";
import { BillingInvoiceLedger } from "./billing-invoice-ledger";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  fetchInvoicesFromSupabase,
  fetchActiveResidentCountForBillingScope,
  type BillingRow,
} from "@/lib/billing/load-invoices";
import { createClient } from "@/lib/supabase/server";

export default async function AdminBillingPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: BillingRow[] = [];
  let initialError: string | null = null;
  let initialCohortCount = 0;

  try {
    initialRows = await fetchInvoicesFromSupabase(initialFacilityId, null, supabase);
    initialCohortCount = await fetchActiveResidentCountForBillingScope(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load data";
  }

  return (
    <div className="space-y-6">
      <BillingArOverviewHero />

      <BillingHubNav />

      <BillingInvoiceLedger
        layout="overview"
        initialRows={initialRows}
        initialError={initialError}
        initialFacilityId={initialFacilityId}
        initialCohortResidentCount={initialCohortCount}
      />
    </div>
  );
}
