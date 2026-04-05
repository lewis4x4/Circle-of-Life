"use client";

import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["loss_runs"]["Row"];

export default function InsuranceLossRunsPage() {
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
      .from("loss_runs")
      .select("*")
      .eq("organization_id", ctx.ctx.organizationId)
      .is("deleted_at", null)
      .order("period_end", { ascending: false });
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Loss runs</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Generated loss summaries by entity and period (export in a later iteration).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Claims</th>
                <th className="py-2 pr-4 font-medium">Paid</th>
                <th className="py-2 font-medium">Reserve</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">
                    {r.period_start} – {r.period_end}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{r.total_claims_count}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(Number(r.total_paid_cents))}</td>
                  <td className="py-2 tabular-nums">{formatUsdFromCents(Number(r.total_reserve_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No loss runs generated yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
