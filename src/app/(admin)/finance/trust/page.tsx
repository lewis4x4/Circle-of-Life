import Link from "next/link";
import { Landmark, Scale, Wallet } from "lucide-react";

import { FinanceHubNav } from "../finance-hub-nav";
import { billingCurrency } from "@/lib/billing/currency";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { formatTrustLastEntryDate } from "@/lib/finance/trust-display-copy";
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
    totalTrust: rows.reduce((sum, row) => sum + (row.currentBalanceCents ?? 0), 0),
    legacyReview: rows.filter(row => row.legacyReviewRequired).length,
    ledgerDifferences: rows.filter(row => !row.ledgerMatchesBalance).length,
  };

  return (
    <div className="space-y-6">
      <FinanceHubNav />

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Resident trust reconciliation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Resident money uses the same ledger as Cash. Bank funds and the accounting liability still require separate reconciliation. Legacy balances await review and are never added to current funds or applied to invoices.
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
          label="Recorded resident funds"
          value={error ? "Unavailable" : summary.legacyReview > 0 ? "Incomplete — review legacy balances" : billingCurrency.format(summary.totalTrust / 100)}
        />
        <TrustMetricCard
          icon={Landmark}
          label="Legacy balances to review"
          value={error ? "Unavailable" : String(summary.legacyReview)}
        />
        <TrustMetricCard
          icon={Scale}
          label="Ledger differences"
          value={error ? "Unavailable" : String(summary.ledgerDifferences)}
          tone={summary.ledgerDifferences > 0 ? "red" : "slate"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resident trust positions</CardTitle>
          <CardDescription>{rows.length} resident-money record(s) in scope</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">Resident</th>
                <th className="pb-2 pr-4 font-medium">Trust balance</th>
                <th className="pb-2 pr-4 font-medium">Legacy balance</th>
                <th className="pb-2 pr-4 font-medium">Review state</th>
                <th className="pb-2 pr-4 font-medium">Last entry</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.residentId} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-3 pr-4">{row.residentName}</td>
                  <td className="py-3 pr-4">{row.currentBalanceCents === null ? "Not established" : billingCurrency.format(row.currentBalanceCents / 100)}</td>
                  <td className="py-3 pr-4">{row.legacyBalanceCents === null ? "None" : billingCurrency.format(row.legacyBalanceCents / 100)}</td>
                  <td className="py-3 pr-4">
                    <span>{row.legacyReviewRequired ? "Legacy review required" : !row.ledgerMatchesBalance ? "Ledger difference" : "Bank and books not verified"}</span>
                  </td>
                  <td className="py-3 pr-4">{formatTrustLastEntryDate(row.lastEntryDate)}</td>
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
              {rows.length === 0 && !error ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No resident-money records in the current scope.
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
