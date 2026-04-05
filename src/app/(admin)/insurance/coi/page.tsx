"use client";

import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["certificates_of_insurance"]["Row"];

export default function InsuranceCoiPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const ctx = await loadFinanceRoleContext(supabase);
    if (!ctx.ok) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("certificates_of_insurance")
      .select("*")
      .eq("organization_id", ctx.ctx.organizationId)
      .is("deleted_at", null)
      .order("expiration_date", { ascending: true });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Certificates of insurance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Third-party COIs (vendors, landlords, lenders) with expiry ordering.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Certificates</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Holder</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Carrier</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.holder_name}</td>
                  <td className="py-2 pr-4">{r.holder_type.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{r.carrier_name}</td>
                  <td className="py-2 pr-4">{r.expiration_date}</td>
                  <td className="py-2 tabular-nums">{formatUsdFromCents(r.aggregate_limit_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No certificates on file.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
