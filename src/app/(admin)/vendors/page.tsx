"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Truck } from "lucide-react";

import { VendorHubNav } from "./vendor-hub-nav";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={openAlerts ? openAlerts > 0 : false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-amber-900/10"
      />
      
      <div className="relative z-10 space-y-6">
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

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              <Sparkline colorClass="text-slate-400" variant={1} />
              <MonolithicWatermark value={vendorCount ?? 0} className="text-slate-800/5 dark:text-white/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 flex items-center gap-2">
                  Active Vendors
                </h3>
                <p className="text-4xl font-mono tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-500 pb-1">{loading ? "…" : vendorCount ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="amber" className={openAlerts ? "border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]" : ""}>
              <Sparkline colorClass="text-amber-500" variant={2} />
              <MonolithicWatermark value={openAlerts ?? 0} className="text-amber-600/5 dark:text-amber-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                     Open Contract Alerts
                  </h3>
                  {openAlerts != null && openAlerts > 0 && <PulseDot colorClass="bg-amber-500" />}
                </div>
                <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">{loading ? "…" : openAlerts ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald">
              <Sparkline colorClass="text-emerald-500" variant={3} />
              <MonolithicWatermark value={mtdSpend ? "$" : ""} className="text-emerald-600/5 dark:text-emerald-400/5 text-4xl opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   MTD Vendor Spend
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1">{loading ? "…" : mtdSpend != null ? formatUsdFromCents(mtdSpend) : "—"}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <div className="relative overflow-visible z-10 w-full mt-4">
        <div className="glass-panel p-4 sm:p-6 mb-4 rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-xl">
          <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Quick links</h3>
          <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">Procurement and AP workflows.</p>
        </div>
        <div className="glass-panel p-6 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-3 text-sm backdrop-blur-2xl shadow-sm">
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/vendors/directory">
            Vendor directory
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/vendors/contracts">
            Contracts
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/vendors/purchase-orders">
            Purchase orders
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/vendors/invoices">
            Vendor invoices
          </Link>
          <Link className="text-indigo-600 dark:text-indigo-400 font-mono text-xs uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/vendors/spend">
            Spend analytics
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}
