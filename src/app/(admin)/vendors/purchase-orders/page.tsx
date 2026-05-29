"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { VendorHubNav } from "../vendor-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type PoRow = Pick<
  Database["public"]["Tables"]["purchase_orders"]["Row"],
  "id" | "po_number" | "status" | "order_date" | "total_cents"
>;

const PURCHASE_ORDER_LIST_LIMIT = 150;

export default function PurchaseOrdersListPage() {
  const supabase = createClient();
  // Identity comes from the app-wide auth provider instead of a per-page
  // getUser() + user_profiles lookup (loadFinanceRoleContext).
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["vendors", "purchase-orders", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<PoRow[]> => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, po_number, status, order_date, total_cents")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("order_date", { ascending: false })
        .limit(PURCHASE_ORDER_LIST_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as PoRow[];
    },
  });

  const loading = authLoading || isPending;
  const loadError =
    !authLoading && !organizationId
      ? "Organization missing on profile."
      : error
        ? error.message
        : null;

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
          <CardTitle className="text-base">Latest POs</CardTitle>
          <CardDescription>{loading ? "Loading…" : `Showing latest ${rows.length} PO(s)`}</CardDescription>
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
