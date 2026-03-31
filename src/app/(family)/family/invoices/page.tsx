"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const rows = [
  { id: "INV-2026-04-001", period: "Apr 2026", total: "$6,420.00", status: "Open" as const, due: "May 5, 2026" },
  { id: "INV-2026-03-001", period: "Mar 2026", total: "$6,180.00", status: "Paid" as const, due: "—" },
  { id: "INV-2026-02-001", period: "Feb 2026", total: "$6,180.00", status: "Paid" as const, due: "—" },
];

export default function FamilyInvoicesPage() {
  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Link
        href="/family/billing"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-stone-600 hover:text-stone-900")}
      >
        <ArrowLeft className="h-4 w-4" />
        Billing summary
      </Link>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-display">
            <FileText className="h-6 w-6 text-orange-600" />
            Invoices
          </CardTitle>
          <CardDescription>
            Statement history for your loved one&apos;s account. Read-only in Phase 1; balances match the billing summary.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((inv) => (
            <div key={inv.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900">{inv.id}</p>
                <Badge
                  className={
                    inv.status === "Open"
                      ? "border-amber-300 bg-amber-100 text-amber-800"
                      : "border-emerald-300 bg-emerald-100 text-emerald-800"
                  }
                >
                  {inv.status}
                </Badge>
              </div>
              <div className="grid gap-1 text-xs text-stone-600 sm:grid-cols-3">
                <span>Period: {inv.period}</span>
                <span>Amount: {inv.total}</span>
                <span>{inv.status === "Open" ? `Due ${inv.due}` : "Paid in full"}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
