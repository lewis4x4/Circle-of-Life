"use client";

import Link from "next/link";
import { ArrowLeft, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const payments = [
  { id: "pmt-1", date: "Apr 3, 2026", amount: "$6,180.00", method: "ACH", reference: "•••• 4821" },
  { id: "pmt-2", date: "Mar 5, 2026", amount: "$6,180.00", method: "Check", reference: "#10482" },
  { id: "pmt-3", date: "Feb 4, 2026", amount: "$6,180.00", method: "ACH", reference: "•••• 4821" },
] as const;

export default function FamilyPaymentsPage() {
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
            <Banknote className="h-6 w-6 text-orange-600" />
            Payments
          </CardTitle>
          <CardDescription>
            Posted payments and methods on file. Phase 1 does not include initiating new payments from this app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
            Read-only history
          </Badge>
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {payments.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-stone-900">{p.amount}</p>
                <p className="text-xs text-stone-600">
                  {p.date} · {p.method}
                </p>
              </div>
              <p className="text-xs text-stone-500">{p.reference}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
