"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { VendorHubNav } from "./vendor-hub-nav";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
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
      <div className="relative z-10 space-y-6">
        <VendorHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4 relative z-10 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/20">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Vendors & Contracts
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
              Manage the vendor master, execute contracts, handle POs, and analyze real-time spend records.
            </p>
          </div>
        </header>

        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        )}

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              <MonolithicWatermark value={vendorCount ?? 0} className="text-muted-foreground/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                  Active Vendors
                </h3>
                <p className="text-4xl font-mono tracking-tighter pb-1">{loading ? "…" : vendorCount ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="amber" className={openAlerts ? "border-warning/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]" : ""}>
              <MonolithicWatermark value={openAlerts ?? 0} className="text-warning/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                   Open Contract Alerts
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">{loading ? "…" : openAlerts ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="emerald">
              <MonolithicWatermark value={mtdSpend ? "$" : ""} className="text-success/10 text-4xl opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   MTD Vendor Spend
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-emerald-600 dark:text-emerald-400 pb-1 tabular-nums">{loading ? "…" : mtdSpend != null ? formatUsdFromCents(mtdSpend) : "—"}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <div className="p-6 sm:p-8 rounded-lg border border-border bg-card shadow-sm relative overflow-visible z-10 w-full mt-8">
        <div className="mb-6 border-b border-border pb-4">
          <h3 className="text-xl font-semibold text-foreground">Quick Links</h3>
          <p className="text-sm font-mono tracking-wide text-muted-foreground mt-1">Jump to procurement and AP workflows.</p>
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
                 <Link href={link.href} className="p-6 rounded-lg group transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 cursor-pointer border border-border bg-card w-full flex flex-col justify-between gap-4 shadow-sm hover:shadow-md hover:border-ring/30 h-[140px] relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                    <div className="relative z-10 flex flex-col gap-1">
                       <span className="font-bold text-foreground uppercase tracking-wider text-xs group-hover:text-primary transition-colors">
                          {link.title}
                       </span>
                       <span className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground pr-4 mt-2 leading-relaxed">
                          {link.desc}
                       </span>
                    </div>
                    <div className="relative z-10 flex justify-end">
                        <div className="h-8 w-8 rounded-full border border-border flex items-center justify-center group-hover:border-ring/20 group-hover:bg-muted transition-colors">
                            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
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
