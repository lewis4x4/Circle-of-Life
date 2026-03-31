"use client";

import { BillingHubNav } from "../billing-hub-nav";
import { BillingInvoiceLedger } from "../billing-invoice-ledger";

export default function AdminBillingInvoicesPage() {
  return (
    <div className="space-y-6">
      <BillingHubNav />
      <BillingInvoiceLedger
        title="Invoices"
        description="Full invoice ledger with filters. Open a row for line items and totals."
        cardTitle="All invoices"
        cardDescription="Sorted by invoice date (newest first), scoped by facility when selected."
      />
    </div>
  );
}
