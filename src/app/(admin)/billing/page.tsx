import { cookies } from "next/headers";

import { BillingHubNav } from "./billing-hub-nav";
import { BillingInvoiceLedger } from "./billing-invoice-ledger";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { fetchInvoicesFromSupabase, type BillingRow } from "@/lib/billing/load-invoices";
import { createClient } from "@/lib/supabase/server";

export default async function AdminBillingPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  const supabase = await createClient();
  let initialRows: BillingRow[] = [];
  let initialError: string | null = null;

  try {
    initialRows = await fetchInvoicesFromSupabase(initialFacilityId, null, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load data";
  }

  return (
    <div className="space-y-6">
      <BillingHubNav />

      <BillingInvoiceLedger
        initialRows={initialRows}
        initialError={initialError}
        initialFacilityId={initialFacilityId}
      />
    </div>
  );
}
