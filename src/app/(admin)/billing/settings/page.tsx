import Link from "next/link";

import { AdminEmptyState } from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BillingHubNav } from "../billing-hub-nav";

export default function AdminBillingSettingsPage() {
  return (
    <div className="space-y-6">
      <BillingHubNav />
      <AdminEmptyState
        title="Billing scheduling not configured"
        description="Automated invoice scheduling is not live in this pilot build. Generate invoices from the overview, import opening balances, or maintain rates in the Rate library until scheduling ships."
      />
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/billing" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
          Billing overview
        </Link>
        <Link
          href="/admin/billing/invoices/opening-balance"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9")}
        >
          Opening balance
        </Link>
        <Link href="/admin/billing/rates" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9")}>
          Rate library
        </Link>
      </div>
    </div>
  );
}
