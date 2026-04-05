"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["insurance_renewals"]["Row"];

export default function InsuranceRenewalsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const ctx = await loadFinanceRoleContext(supabase);
    if (!ctx.ok) {
      setRows([]);
      setLoadError(ctx.error);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("insurance_renewals")
      .select("*")
      .eq("organization_id", ctx.ctx.organizationId)
      .is("deleted_at", null)
      .order("target_effective_date", { ascending: true });
    if (error) {
      setLoadError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Renewals</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Renewal milestones and quoted or bound premiums.</p>
      </div>
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Renewal pipeline</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Target effective</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Quoted</th>
                <th className="py-2 pr-4 font-medium">Bound</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.target_effective_date}</td>
                  <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.quoted_premium_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.bound_premium_cents)}</td>
                  <td className="py-2">
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      href={`/admin/insurance/policies/${r.insurance_policy_id}`}
                    >
                      Policy
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No renewals yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
