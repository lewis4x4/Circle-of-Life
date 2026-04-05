"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { VendorHubNav } from "../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type PoRow = Database["public"]["Tables"]["purchase_orders"]["Row"];

export default function PurchaseOrdersListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    if (!c.ok) {
      setRows([]);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("order_date", { ascending: false });
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as PoRow[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

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
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Purchase orders</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Facility-scoped PO workflow.</p>
        </div>
        <Link className={cn(buttonVariants({ size: "sm" }))} href="/admin/vendors/purchase-orders/new">
          New PO
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All POs</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} PO(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">PO #</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Order date</th>
                <th className="pb-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/vendors/purchase-orders/${r.id}`}>
                      {r.po_number}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 capitalize">{r.status.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.order_date}</td>
                  <td className="py-2">{formatUsdFromCents(r.total_cents)}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-slate-500">
                    No purchase orders yet.
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
