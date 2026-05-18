"use client";

import { BillingHubNav } from "../billing-hub-nav";
import { BillingInvoiceLedger } from "../billing-invoice-ledger";

export default function AdminBillingInvoicesPage() {
  return (
    <div className="space-y-6">
      <BillingHubNav />
      <BillingInvoiceLedger
        title="Invoices"
        layout="standard"
        cardTitle="All invoices"
        cardDescription="Full ledger with filters. Open a row for line items and totals. Sorted by invoice date (newest first); scoped when a facility is selected."
      />
    </div>
  );
}
