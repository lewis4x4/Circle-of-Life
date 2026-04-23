import { BillingHubNav } from "./billing-hub-nav";
import { BillingInvoiceLedger } from "./billing-invoice-ledger";

export default function AdminBillingPage() {
  return (
    <div className="space-y-6">
      <BillingHubNav />

      <BillingInvoiceLedger />
    </div>
  );
}
