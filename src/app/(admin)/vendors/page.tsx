"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Truck } from "lucide-react";

import { VendorHubNav } from "./vendor-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";

export default function AdminVendorsHubPage() {
  const supabase = createClient();
  const [vendorCount, setVendorCount] = useState<number | null>(null);
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);
  const [mtdSpend, setMtdSpend] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setVendorCount(null);
        setOpenAlerts(null);
        setMtdSpend(null);
        setLoadError(ctx.error);
        return;
      }
      const orgId = ctx.ctx.organizationId;
      const [{ count: vCount, error: e1 }, { count: aCount, error: e2 }, paymentsRes] = await Promise.all([
        supabase
          .from("vendors")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null),
        supabase
          .from("contract_alerts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "pending")
          .is("deleted_at", null),
        supabase
          .from("vendor_payments")
          .select("amount_cents")
          .eq("organization_id", orgId)
          .gte("payment_date", monthStart)
          .is("deleted_at", null),
      ]);
      const err = e1 ?? e2 ?? paymentsRes.error;
      if (err) {
        setLoadError(err.message);
        setVendorCount(null);
        setOpenAlerts(null);
        setMtdSpend(null);
        return;
      }
      setVendorCount(vCount ?? 0);
      setOpenAlerts(aCount ?? 0);
      const rows = paymentsRes.data ?? [];
      setMtdSpend(rows.reduce((s, r) => s + (r.amount_cents ?? 0), 0));
    } finally {
      setLoading(false);
    }
  }, [supabase, monthStart]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="space-y-6">
      <VendorHubNav />
      <div className="flex items-center gap-3">
        <Truck className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Vendors & contracts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Vendor master, contracts, POs, invoices, and spend (Module 19).
          </p>
        </div>
      </div>

      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active vendors</CardTitle>
            <CardDescription>Vendor records in your organization.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{loading ? "…" : vendorCount ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open contract alerts</CardTitle>
            <CardDescription>Alerts still marked pending.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{loading ? "…" : openAlerts ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MTD vendor spend</CardTitle>
            <CardDescription>Recorded vendor payments this calendar month.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? "…" : mtdSpend != null ? formatUsdFromCents(mtdSpend) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick links</CardTitle>
          <CardDescription>Procurement and AP workflows.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/directory">
            Vendor directory
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/contracts">
            Contracts
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/purchase-orders">
            Purchase orders
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/invoices">
            Vendor invoices
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/vendors/spend">
            Spend analytics
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
