"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Landmark, Scale, Wallet } from "lucide-react";

import { FinanceHubNav } from "../finance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { billingCurrency } from "@/app/(admin)/billing/billing-invoice-ledger";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type TrustEntry = {
  id: string;
  resident_id: string;
  facility_id: string;
  entry_date: string;
  entry_type: string;
  amount_cents: number;
  balance_after_cents: number;
  notes: string | null;
};

type ResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string;
};

type InvoiceMini = {
  resident_id: string;
  balance_due: number;
  status: string;
  facility_id: string;
};

type ResidentTrustRow = {
  residentId: string;
  residentName: string;
  currentBalanceCents: number;
  openInvoiceCents: number;
  deltaCents: number;
  facilityId: string;
  lastEntryDate: string | null;
  entriesCount: number;
};

export default function FinanceTrustPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ResidentTrustRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      let trustQuery = supabase
        .from("trust_account_entries")
        .select("id, resident_id, facility_id, entry_date, entry_type, amount_cents, balance_after_cents, notes")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(1000);

      let residentQuery = supabase
        .from("residents")
        .select("id, first_name, last_name, facility_id")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null);

      let invoiceQuery = supabase
        .from("invoices" as never)
        .select("resident_id, balance_due, status, facility_id")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .in("status", ["sent", "partial", "overdue"]);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        trustQuery = trustQuery.eq("facility_id", selectedFacilityId);
        residentQuery = residentQuery.eq("facility_id", selectedFacilityId);
        invoiceQuery = invoiceQuery.eq("facility_id", selectedFacilityId);
      }

      const [trustRes, residentRes, invoiceRes] = await Promise.all([trustQuery, residentQuery, invoiceQuery]);
      if (trustRes.error) throw trustRes.error;
      if (residentRes.error) throw residentRes.error;
      if (invoiceRes.error) throw invoiceRes.error;

      const trustEntries = (trustRes.data ?? []) as TrustEntry[];
      const residents = (residentRes.data ?? []) as ResidentMini[];
      const invoices = (invoiceRes.data ?? []) as unknown as InvoiceMini[];

      const residentMap = new Map(residents.map((resident) => [
        resident.id,
        `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || resident.id,
      ]));

      const latestBalance = new Map<string, { balance: number; facilityId: string; lastEntryDate: string | null; entriesCount: number }>();
      for (const entry of trustEntries) {
        const existing = latestBalance.get(entry.resident_id);
        if (!existing) {
          latestBalance.set(entry.resident_id, {
            balance: entry.balance_after_cents,
            facilityId: entry.facility_id,
            lastEntryDate: entry.entry_date,
            entriesCount: 1,
          });
        } else {
          existing.entriesCount += 1;
        }
      }

      const invoiceTotals = new Map<string, number>();
      for (const invoice of invoices) {
        invoiceTotals.set(invoice.resident_id, (invoiceTotals.get(invoice.resident_id) ?? 0) + Math.max(0, invoice.balance_due ?? 0));
      }

      const trustRows = Array.from(latestBalance.entries()).map(([residentId, snapshot]) => {
        const openInvoiceCents = invoiceTotals.get(residentId) ?? 0;
        return {
          residentId,
          residentName: residentMap.get(residentId) ?? residentId,
          currentBalanceCents: snapshot.balance,
          openInvoiceCents,
          deltaCents: snapshot.balance - openInvoiceCents,
          facilityId: snapshot.facilityId,
          lastEntryDate: snapshot.lastEntryDate,
          entriesCount: snapshot.entriesCount,
        };
      }).sort((left, right) => left.deltaCents - right.deltaCents);

      setRows(trustRows);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load trust reconciliation.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const totalTrust = rows.reduce((sum, row) => sum + row.currentBalanceCents, 0);
    const totalOpenInvoices = rows.reduce((sum, row) => sum + row.openInvoiceCents, 0);
    const deficits = rows.filter((row) => row.deltaCents < 0).length;
    return { totalTrust, totalOpenInvoices, deficits };
  }, [rows]);

  return (
    <div className="space-y-6">
      <FinanceHubNav />

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Resident trust reconciliation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Compare current resident trust balances against open invoice exposure and surface deficit accounts before month-end close.
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

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
          <CardDescription>
            {loading ? "Loading trust positions..." : `${rows.length} resident trust account(s) in scope`}
          </CardDescription>
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
                      <Link href={`/admin/residents/${row.residentId}/billing`} className="text-primary underline-offset-4 hover:underline">
                        Billing
                      </Link>
                      <Link href="/admin/finance/period-close" className="text-primary underline-offset-4 hover:underline">
                        Close
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No trust-account entries in the current scope.
                  </td>
                </tr>
              )}
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
