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
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowRight } from "lucide-react";

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
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4 relative z-10 transition-all hover:bg-white/50 dark:hover:bg-black/30">
          <div className="space-y-3">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 <Truck className="h-3.5 w-3.5" aria-hidden /> SYS: Module 19
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Vendors & Contracts
             </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Manage the vendor master, execute contracts, handle POs, and analyze real-time spend records.
            </p>
          </div>
        </header>

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

      <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all mt-8">
        <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
          <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Quick Links</h3>
          <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400 mt-1">Jump to procurement and AP workflows.</p>
        </div>
        
        <MotionList className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {[
             { title: "Vendor directory", href: "/admin/vendors/directory", desc: "View and manage active vendors" },
             { title: "Contracts", href: "/admin/vendors/contracts", desc: "Manage SLAs and master agreements" },
             { title: "Purchase orders", href: "/admin/vendors/purchase-orders", desc: "Track organizational POs" },
             { title: "Vendor invoices", href: "/admin/vendors/invoices", desc: "Reconcile vendor AP" },
             { title: "Spend analytics", href: "/admin/vendors/spend", desc: "Review MTD and historic expenditures" },
           ].map((link) => (
             <MotionItem key={link.href}>
                 <Link href={link.href} className="p-6 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-pointer border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] w-full flex flex-col justify-between gap-4 backdrop-blur-xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/30 h-[140px] relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-indigo-500/0 group-hover:from-indigo-50/50 group-hover:to-transparent dark:group-hover:from-indigo-500/5 transition-colors" />
                    <div className="relative z-10 flex flex-col gap-1">
                       <span className="font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest text-xs group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {link.title}
                       </span>
                       <span className="text-[10px] font-mono tracking-widest uppercase text-slate-500 dark:text-slate-400 pr-4 mt-2 leading-relaxed">
                          {link.desc}
                       </span>
                    </div>
                    <div className="relative z-10 flex justify-end">
                        <div className="h-8 w-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center group-hover:border-indigo-200 dark:group-hover:border-indigo-500/20 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/10 transition-colors">
                            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                        </div>
                    </div>
                 </Link>
             </MotionItem>
           ))}
        </MotionList>
      </div>
      </div>
    </div>
  );
}
