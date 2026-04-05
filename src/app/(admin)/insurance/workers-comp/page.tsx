"use client";

import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["workers_comp_claims"]["Row"];

export default function InsuranceWorkersCompPage() {
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
      .from("workers_comp_claims")
      .select("*")
      .eq("organization_id", ctx.ctx.organizationId)
      .is("deleted_at", null)
      .order("injury_date", { ascending: false });
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Workers’ compensation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Facility-scoped WC claim headers (OSHA 300 detail is out of Core scope).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claims</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Injury date</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Reserve</th>
                <th className="py-2 pr-4 font-medium">Paid</th>
                <th className="py-2 font-medium">Return to work</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.injury_date}</td>
                  <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.reserve_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.paid_cents)}</td>
                  <td className="py-2">{r.return_to_work_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No workers’ comp claims yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
