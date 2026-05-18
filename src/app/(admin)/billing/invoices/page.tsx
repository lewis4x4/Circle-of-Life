"use client";

import { BillingArOverviewHero } from "../billing-ar-overview-hero";
import { BillingHubNav } from "../billing-hub-nav";
import { BillingInvoiceLedger } from "../billing-invoice-ledger";

export default function AdminBillingInvoicesPage() {
  return (
    <div className="space-y-6">
      <BillingArOverviewHero />
      <BillingHubNav />
      <BillingInvoiceLedger
        title="Invoices"
        layout="standard"
        cardTitle="All invoices"
        cardDescription="Full invoice ledger for the selected scope. Click any row for line items, payment history, and status timeline."
      />
    </div>
  );
}
