"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { VendorHubNav } from "../vendor-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type ContractRow = Database["public"]["Tables"]["contracts"]["Row"];

export default function VendorContractsListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<(ContractRow & { vendor_name?: string })[]>([]);
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
      .from("contracts")
      .select("*")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("expiration_date", { ascending: true, nullsFirst: false });
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      const list = (data ?? []) as ContractRow[];
      const vids = [...new Set(list.map((r) => r.vendor_id))];
      const { data: vrows } = await supabase.from("vendors").select("id, name").in("id", vids);
      const vmap = new Map((vrows ?? []).map((v) => [v.id as string, v.name as string]));
      setRows(list.map((r) => ({ ...r, vendor_name: vmap.get(r.vendor_id) })));
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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Contracts</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Vendor agreements and key dates.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All contracts</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} contract(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">Title</th>
                <th className="pb-2 pr-4 font-medium">Vendor</th>
                <th className="pb-2 pr-4 font-medium">Effective</th>
                <th className="pb-2 pr-4 font-medium">Expires</th>
                <th className="pb-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/vendors/contracts/${r.id}`}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{r.vendor_name ?? "—"}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.effective_date}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.expiration_date ?? "—"}</td>
                  <td className="py-2">{formatUsdFromCents(r.total_value_cents)}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-slate-500">
                    No contracts yet.
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
