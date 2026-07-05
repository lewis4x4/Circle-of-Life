"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { VendorHubNav } from "../vendor-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";

type Agg = { vendor_id: string; name: string; cents: number };

export default function VendorSpendPage() {
  const supabase = createClient();
  // Identity comes from the app-wide auth provider instead of a per-page
  // duplicate auth/profile lookup.
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["vendors", "spend", organizationId],
    enabled: !!organizationId,
    // Client-side aggregation is preserved here (caches across navigation); a
    // SQL-aggregate rewrite is tracked as a separate later task.
    queryFn: async (): Promise<Agg[]> => {
      const { data: payments, error } = await supabase
        .from("vendor_payments")
        .select("vendor_id, amount_cents")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      const map = new Map<string, Agg>();
      const ids = [...new Set((payments ?? []).map((p) => (p as { vendor_id: string }).vendor_id))];
      const { data: vrows } = await supabase.from("vendors").select("id, name").in("id", ids);
      const vmap = new Map((vrows ?? []).map((v) => [v.id as string, v.name as string]));
      for (const p of payments ?? []) {
        const row = p as { vendor_id: string; amount_cents: number };
        const name = vmap.get(row.vendor_id) ?? row.vendor_id;
        const cur = map.get(row.vendor_id) ?? { vendor_id: row.vendor_id, name, cents: 0 };
        cur.cents += row.amount_cents;
        cur.name = name;
        map.set(row.vendor_id, cur);
      }
      return [...map.values()].sort((a, b) => b.cents - a.cents);
    },
  });

  const loading = authLoading || isPending;
  const loadError =
    !authLoading && !organizationId
      ? "Organization missing on profile."
      : error
        ? error.message
        : null;

  const csv = useMemo(() => {
    const header = "vendor_id,vendor_name,amount_cents\n";
    const body = rows.map((r) => `${r.vendor_id},"${r.name.replace(/"/g, '""')}",${r.cents}`).join("\n");
    return header + body;
  }, [rows]);

  function downloadCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vendor-spend-by-vendor.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Spend analytics</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Totals by vendor from recorded payments.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!rows.length} onClick={downloadCsv}>
          Export CSV
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By vendor</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} vendor(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">Vendor</th>
                <th className="pb-2 font-medium">Total paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vendor_id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2">{formatUsdFromCents(r.cents)}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-6 text-slate-500">
                    No payment data yet.
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
