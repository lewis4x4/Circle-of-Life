"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminEmptyState } from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BillingHubNav } from "../billing-hub-nav";

export default function AdminBillingSettingsPage() {
  return (
    <div className="space-y-6">
      <BillingHubNav />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/billing"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Billing overview
        </Link>
        <Link
          href="/admin/billing/invoices/opening-balance"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          Opening balance
        </Link>
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Billing settings</h1>
        <p className="text-sm text-muted-foreground">
          Invoice scheduling is not live. Use overview generation, opening balances, and the rate library until it ships.
        </p>
      </div>

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
