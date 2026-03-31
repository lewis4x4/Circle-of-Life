"use client";

import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { BillingHubNav } from "../../billing-hub-nav";

export default function AdminInvoiceGeneratePage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-slate-500" />
            <CardTitle className="text-xl">Generate invoice</CardTitle>
          </div>
          <CardDescription>
            Phase 1 contract route. Batch generation from care periods and rate schedules will plug in here; for now
            this screen is a safe placeholder.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/admin/billing/invoices" className={buttonVariants({ variant: "default", size: "sm" })}>
            View invoices
          </Link>
          <Link href="/admin/billing/rates" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Rate schedules
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
