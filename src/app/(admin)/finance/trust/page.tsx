import Link from "next/link";
import { Landmark, Scale, Wallet } from "lucide-react";

import { FinanceHubNav } from "../finance-hub-nav";
import { billingCurrency } from "@/app/(admin)/billing/billing-invoice-ledger";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { loadFinanceTrustData, type ResidentTrustRow } from "@/lib/finance/load-trust-data";
import { createClient } from "@/lib/supabase/server";

export default async function FinanceTrustPage() {
  const roleContext = await loadFinanceRoleContextServer();
  const selectedFacilityId = await getServerSelectedFacilityId();

  if (!roleContext.ok) {
    return (
      <div className="space-y-6">
        <FinanceHubNav />
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-700">{roleContext.error}</CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  let rows: ResidentTrustRow[] = [];
  let error: string | null = null;

  try {
    rows = await loadFinanceTrustData(
      supabase,
      roleContext.ctx.organizationId,
      selectedFacilityId,
    );
  } catch (caughtError) {
    error =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to load trust reconciliation.";
  }

  const summary = {
    totalTrust: rows.reduce((sum, row) => sum + row.currentBalanceCents, 0),
    totalOpenInvoices: rows.reduce((sum, row) => sum + row.openInvoiceCents, 0),
    deficits: rows.filter((row) => row.deltaCents < 0).length,
  };

  return (
    <div className="space-y-6">
      <FinanceHubNav />

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Resident trust reconciliation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Compare current resident trust balances against open invoice exposure and surface deficit accounts before month-end close.
        </p>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <TrustMetricCard
          icon={Wallet}
          label="Trust balance"
          value={billingCurrency.format(summary.totalTrust / 100)}
        />
        <TrustMetricCard
          icon={Landmark}
          label="Open invoices"
          value={billingCurrency.format(summary.totalOpenInvoices / 100)}
        />
        <TrustMetricCard
          icon={Scale}
          label="Deficit residents"
          value={String(summary.deficits)}
          tone={summary.deficits > 0 ? "red" : "emerald"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resident trust positions</CardTitle>
          <CardDescription>{rows.length} resident trust account(s) in scope</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">Resident</th>
                <th className="pb-2 pr-4 font-medium">Trust balance</th>
                <th className="pb-2 pr-4 font-medium">Open invoices</th>
                <th className="pb-2 pr-4 font-medium">Delta</th>
                <th className="pb-2 pr-4 font-medium">Last entry</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.residentId} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-3 pr-4">{row.residentName}</td>
                  <td className="py-3 pr-4">{billingCurrency.format(row.currentBalanceCents / 100)}</td>
                  <td className="py-3 pr-4">{billingCurrency.format(row.openInvoiceCents / 100)}</td>
                  <td className="py-3 pr-4">
                    <span className={row.deltaCents < 0 ? "text-red-600" : "text-emerald-600"}>
                      {billingCurrency.format(row.deltaCents / 100)}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{row.lastEntryDate ?? "—"}</td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <Link
                        href={`/admin/residents/${row.residentId}/billing`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Billing
                      </Link>
                      <Link
                        href="/admin/finance/period-close"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Close
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No trust-account entries in the current scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function TrustMetricCard({
  icon: Icon,
  label,
  value,
  tone = "slate",
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tone?: "slate" | "red" | "emerald";
}) {
  const toneClass =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <Card className={toneClass}>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-inherit">
          <Icon className="h-4 w-4" />
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardContent>
    </Card>
  );
}
