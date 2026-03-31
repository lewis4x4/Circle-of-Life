"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

import { AdminEmptyState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

type SupabasePayment = {
  payment_date: string;
  amount: number;
  deleted_at: string | null;
};

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, 1);
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(d);
}

export default function AdminRevenuePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [byMonth, setByMonth] = useState<{ key: string; cents: number; count: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const since = new Date();
      since.setMonth(since.getMonth() - 14);
      const sinceStr = since.toISOString().slice(0, 10);
      let q = supabase
        .from("payments" as never)
        .select("payment_date, amount, deleted_at")
        .is("deleted_at", null)
        .gte("payment_date", sinceStr)
        .eq("refunded", false)
        .limit(2000);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const res = (await q) as unknown as QueryListResult<SupabasePayment>;
      if (res.error) throw res.error;
      const payments = res.data ?? [];
      const map = new Map<string, { cents: number; count: number }>();
      for (const p of payments) {
        const k = monthKey(p.payment_date);
        const cur = map.get(k) ?? { cents: 0, count: 0 };
        cur.cents += Math.max(0, p.amount);
        cur.count += 1;
        map.set(k, cur);
      }
      const rows = [...map.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.key.localeCompare(a.key));
      setByMonth(rows);
    } catch {
      setByMonth([]);
      setError("Could not load payment revenue.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grand = useMemo(() => byMonth.reduce((acc, r) => acc + r.cents, 0), [byMonth]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Revenue
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Cash collected from payments (refunds excluded), grouped by calendar month.
          </p>
        </div>
      </header>

      {error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}

      {!isLoading && byMonth.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Trailing window</CardTitle>
              <CardDescription>{billingCurrency.format(grand / 100)} over {byMonth.length} month(s)</CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && byMonth.length === 0 && !error ? (
        <AdminEmptyState title="No payments in range" description="Try another facility or extend the data window." />
      ) : null}
      {!isLoading && byMonth.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">By month</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMonth.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{monthLabel(r.key)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600 dark:text-slate-400">{r.count}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {billingCurrency.format(r.cents / 100)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
