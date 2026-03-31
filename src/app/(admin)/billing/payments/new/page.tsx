"use client";

import Link from "next/link";
import { Banknote } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { BillingHubNav } from "../../billing-hub-nav";

export default function AdminNewPaymentPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-slate-500" />
            <CardTitle className="text-xl">Record payment</CardTitle>
          </div>
          <CardDescription>
            Phase 1 contract route. Payment entry against invoices will use the payments table with RLS; this page
            reserves the URL and navigation target.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/admin/billing/invoices" className={buttonVariants({ variant: "default", size: "sm" })}>
            Open invoices
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
