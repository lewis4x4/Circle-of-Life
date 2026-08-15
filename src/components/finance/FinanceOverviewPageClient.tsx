"use client";

import Link from "next/link";
import { Landmark } from "lucide-react";

import { FinanceHubNav } from "@/app/(admin)/finance/finance-hub-nav";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import {
  financeOverviewKpiTileValue,
  type FinanceOverviewKpiContext,
} from "@/lib/finance/finance-overview-display-copy";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type FinanceOverviewPageClientProps = {
  roleLabel: string;
  postedCount: number | null;
  unpostedInvoices: number | null;
  initialError: string | null;
};

export default function AdminFinanceHubPageClient({
  roleLabel,
  postedCount,
  unpostedInvoices,
  initialError,
}: FinanceOverviewPageClientProps) {
  const kpiCtx: FinanceOverviewKpiContext = { loadFailed: Boolean(initialError) };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <FinanceHubNav />
        <div className="flex items-center gap-3">
          <Landmark className="h-8 w-8 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Finance</h1>
            <p className="text-sm text-muted-foreground">
              Entity and facility general ledger (Module 17) — chart of accounts, journal entries, ledger.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {roleLabel} drill-in: use finance to confirm whether portfolio pressure is operational, billing-timing, or period-close related.
            </p>
          </div>
        </div>
        {initialError ? (
          <AdminLiveDataFallbackNotice message={initialError} onRetry={() => window.location.reload()} />
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { title: "Executive alerts", description: "Return to the leadership exception queue after checking the ledger context.", href: "/admin/executive/alerts" },
            { title: "Insurance & risk", description: "Open policies and claims when a finance issue has risk or reserve implications.", href: "/admin/insurance" },
            { title: "Executive reports", description: `Move into saved executive reporting without leaving the ${roleLabel.toLowerCase()} decision lane.`, href: "/admin/executive/reports" },
          ].map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="rounded-lg border border-border bg-card p-5 shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            >
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-foreground">{item.description}</p>
            </Link>
          ))}
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={75}>
          <div className="col-span-1 h-[160px]">
            <V2Card hoverColor="slate" className="flex flex-col">
              <div className="mb-2">
                <h3 className="text-base font-semibold text-foreground">Finance controls</h3>
                <p className="text-[10px] text-muted-foreground">Leadership drill-ins for GL truth, period status, and posting confidence.</p>
              </div>
              <div className="flex flex-col gap-1 text-[11px] overflow-y-auto flex-1">
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/chart-of-accounts">
                  Chart of accounts
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/journal-entries">
                  Journal entries
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/ledger">
                  Posted ledger (read-only)
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/trial-balance">
                  Trial balance
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/posting-rules">
                  GL posting rules
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/period-close">
                  Period close
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/forecast">
                  Forecast
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/budget">
                  Budget vs actual
                </Link>
                <Link className="text-primary-600 dark:text-primary-400 font-mono hover:text-primary-500 transition-colors" href="/admin/finance/gl-settings">
                  GL settings
                </Link>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              {postedCount != null ? (
                <MonolithicWatermark value={postedCount} className="text-muted-foreground/10 opacity-50" />
              ) : null}
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                  Posted Entries (30d)
                </h3>
                <p className="text-4xl font-mono tracking-tighter pb-1">
                  {financeOverviewKpiTileValue("posted_count", postedCount, kpiCtx)}
                </p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="amber" className={unpostedInvoices ? "border-warning/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]" : ""}>
              {unpostedInvoices != null ? (
                <MonolithicWatermark value={unpostedInvoices} className="text-warning/10 opacity-50" />
              ) : null}
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                   Unposted Invoices
                </h3>
                <div>
                  <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">
                    {financeOverviewKpiTileValue("unposted_invoices", unpostedInvoices, kpiCtx)}
                  </p>
                  {unpostedInvoices != null && unpostedInvoices > 0 && (
                    <Link className="mt-1 block text-[10px] font-mono text-amber-600/80 hover:text-amber-600 dark:text-amber-400/80 dark:hover:text-amber-400 underline-offset-4 hover:underline" href="/admin/billing/invoices">
                      Review Invoices →
                    </Link>
                  )}
                </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

        {/* ACTION QUEUE: Financial Triage */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6 border-t border-border">
          
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                Action Ledger
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {unpostedInvoices === 0 ? (
                <div className="p-8 text-center text-muted-foreground bg-card rounded-lg border border-border shadow-sm">
                   <p className="font-medium text-foreground">Ledger Reconciled</p>
                   <p className="text-sm opacity-80 font-mono tracking-wide mt-1">All invoices and journal entries are currently posted.</p>
                </div>
              ) : (
                unpostedInvoices != null && unpostedInvoices > 0 ? (
                  <MotionItem className="p-5 rounded-lg border border-warning/20 bg-warning/10">
                    <p className="text-sm font-medium text-foreground">
                      {unpostedInvoices} unposted invoice{unpostedInvoices === 1 ? "" : "s"} pending GL posting.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Review invoices in Billing to post journal entries from live billing records.
                    </p>
                    <Link
                      href="/admin/billing/invoices"
                      className={cn(
                        buttonVariants({ variant: "default", size: "sm" }),
                        "mt-4 bg-amber-600 hover:bg-amber-700 text-black font-mono text-[9px] shadow-sm",
                      )}
                    >
                      Open invoices
                    </Link>
                  </MotionItem>
                ) : null
              )}
            </MotionList>
          </div>

          <div className="col-span-1 border-l border-border pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-border mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                Period Status
              </h3>
            </div>
            
            <div className="space-y-4">
              <div className="p-4 rounded-lg border border-border bg-card shadow-sm">
                <p className="text-sm text-muted-foreground">Period close status is managed under Period close from live finance records.</p>
                <Link
                  href="/admin/finance/period-close"
                  className="mt-3 inline-block text-[11px] font-mono text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Open period close →
                </Link>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
