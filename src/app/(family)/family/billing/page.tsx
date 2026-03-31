"use client";

import { CreditCard, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const invoices = [
  { id: "INV-2026-04-001", period: "Apr 2026", total: "$6,420.00", status: "Open", due: "May 5" },
  { id: "INV-2026-03-001", period: "Mar 2026", total: "$6,180.00", status: "Paid", due: "Apr 5" },
  { id: "INV-2026-02-001", period: "Feb 2026", total: "$6,180.00", status: "Paid", due: "Mar 5" },
];

export default function FamilyBillingSummaryPage() {
  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Billing Summary</CardTitle>
          <CardDescription>Read-only overview of current balance and recent invoices.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <SummaryPill label="Current balance" value="$6,420.00" tone="warning" />
          <SummaryPill label="Last payment" value="$6,180.00" tone="neutral" />
          <SummaryPill label="Payment date" value="Apr 3, 2026" tone="neutral" />
          <SummaryPill label="Account status" value="In good standing" tone="success" />
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{invoice.id}</p>
                <Badge
                  className={
                    invoice.status === "Open"
                      ? "border-amber-300 bg-amber-100 text-amber-800"
                      : "border-emerald-300 bg-emerald-100 text-emerald-800"
                  }
                >
                  {invoice.status}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-stone-600">
                <p>{invoice.period}</p>
                <p>{invoice.total}</p>
                <p>Due {invoice.due}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardContent className="p-4">
          <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Phase 1 billing scope
          </p>
          <p className="mb-3 text-sm text-stone-700">
            Family billing is read-only during this phase. Online payment actions are scheduled for a
            future release.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-10 border-stone-300 bg-white text-stone-800 hover:bg-stone-50">
              <FileText className="mr-1.5 h-4 w-4" />
              View Invoices
            </Button>
            <Button variant="outline" className="h-10 border-stone-300 bg-white text-stone-800 hover:bg-stone-50">
              <CreditCard className="mr-1.5 h-4 w-4" />
              View Payments
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-300 bg-amber-50"
      : tone === "success"
        ? "border-emerald-300 bg-emerald-50"
        : "border-stone-200 bg-stone-50";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}
