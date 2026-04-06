"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Landmark } from "lucide-react";

import { FinanceHubNav } from "./finance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";

export default function AdminFinanceHubPage() {
  const supabase = createClient();
  const [postedCount, setPostedCount] = useState<number | null>(null);
  const [unpostedInvoices, setUnpostedInvoices] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setPostedCount(null);
        return;
      }
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      const iso = start.toISOString().slice(0, 10);
      const [{ count }, { count: invTotal }, { data: postedSources }] = await Promise.all([
        supabase
          .from("journal_entries")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("status", "posted")
          .gte("entry_date", iso)
          .is("deleted_at", null),
        supabase
          .from("invoices" as never)
          .select("id", { count: "exact", head: true })
          .eq("organization_id" as never, ctx.ctx.organizationId as never)
          .is("deleted_at" as never, null as never),
        supabase
          .from("journal_entries")
          .select("source_id")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("source_type", "invoice")
          .is("deleted_at", null),
      ]);
      setPostedCount(count ?? 0);
      const postedIds = new Set((postedSources ?? []).map((r) => (r as { source_id: string | null }).source_id));
      const totalInv = invTotal ?? 0;
      setUnpostedInvoices(Math.max(0, totalInv - postedIds.size));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div className="flex items-center gap-3">
        <Landmark className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Finance</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Entity and facility general ledger (Module 17) — chart of accounts, journal entries, ledger.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick links</CardTitle>
            <CardDescription>Manage GL data for your organization.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/chart-of-accounts">
              Chart of accounts
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/journal-entries">
              Journal entries
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/ledger">
              Posted ledger (read-only)
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/trial-balance">
              Trial balance
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/posting-rules">
              GL posting rules
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/period-close">
              Period close
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/budget">
              Budget vs actual
            </Link>
            <Link className="text-primary underline-offset-4 hover:underline" href="/admin/finance/gl-settings">
              GL settings
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posted entries (last 30 days)</CardTitle>
            <CardDescription>Count of posted journal headers.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? "…" : postedCount ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unposted invoices</CardTitle>
            <CardDescription>Billing invoices not yet posted to GL.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? "…" : unpostedInvoices ?? "—"}
            </p>
            {unpostedInvoices != null && unpostedInvoices > 0 && (
              <Link className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline" href="/admin/billing/invoices">
                Review invoices
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
