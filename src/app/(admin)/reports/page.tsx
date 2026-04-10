"use client";

import { useEffect, useMemo, useState } from "react";
import { Fingerprint, Layers, Clock, FolderOpen, Save, type LucideIcon } from "lucide-react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { createClient } from "@/lib/supabase/client";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { cn } from "@/lib/utils";
import Link from "next/link";

import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type CountCard = { title: string; value: number; hint: string; icon: LucideIcon; color: string; href: string; variant: 1 | 2 | 3 | 4 | 5 };

export default function ReportsOverviewPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CountCard[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);

        const [templatesRes, savedRes, schedulesRes, packsRes, runsRes] = await Promise.all([
          supabase.from("report_templates").select("id", { count: "exact", head: true }),
          supabase
            .from("report_saved_views")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null),
          supabase
            .from("report_schedules")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null)
            .eq("status", "active"),
          supabase
            .from("report_packs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null)
            .eq("active", true),
          supabase
            .from("report_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId),
        ]);

        const firstError = [
          templatesRes.error,
          savedRes.error,
          schedulesRes.error,
          packsRes.error,
          runsRes.error,
        ].find(Boolean);
        if (firstError) throw new Error(firstError.message);

        if (alive) {
          setCards([
            {
              title: "Template Library",
              value: templatesRes.count ?? 0,
              hint: "Official and custom templates",
              icon: Fingerprint,
              color: "indigo",
              href: "/admin/reports/templates",
              variant: 1
            },
            {
              title: "Saved Reports",
              value: savedRes.count ?? 0,
              hint: "Pinned or inherited variants",
              icon: Save,
              color: "emerald",
              href: "/admin/reports/saved",
              variant: 2
            },
            {
              title: "Active Schedules",
              value: schedulesRes.count ?? 0,
              hint: "Recurring report jobs",
              icon: Clock,
              color: "amber",
              href: "/admin/reports/scheduled",
              variant: 3
            },
            {
              title: "Report Packs",
              value: packsRes.count ?? 0,
              hint: "Executive & compliance bundles",
              icon: FolderOpen,
              color: "rose",
              href: "/admin/reports/packs",
              variant: 4
            },
            {
              title: "Run History",
              value: runsRes.count ?? 0,
              hint: "Executed report runs audit log",
              icon: Layers,
              color: "blue",
              href: "/admin/reports/history",
              variant: 5
            },
          ]);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load reporting overview.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const orderedCards = useMemo(() => cards, [cards]);
  const placeholderCards = useMemo<CountCard[]>(
    () =>
      Array.from({ length: 5 }, (_, index) => ({
        title: `Asset group ${index+1}`,
        value: 0,
        hint: "Auditing catalog...",
        icon: Fingerprint,
        color: "slate",
        href: "#",
        variant: 1
      })),
    []
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto px-4 sm:px-6 xl:px-0">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              <Layers className="h-10 w-10 text-indigo-500" strokeWidth={1.5} />
              Reporting Hub
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-balance">
              Template-first reporting with scheduling, packs, and audited exports.
            </p>
          </div>
        </header>

      {error && (
         <div className="glass-panel rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6 text-sm text-rose-600 dark:text-rose-400 font-medium tracking-wide flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
               <span className="font-bold">!</span>
            </div>
            {error}
         </div>
      )}

      {/* ─── METRIC PILLARS ─── */}
      <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4" staggerMs={75}>
        {(loading ? placeholderCards : orderedCards).map((card, idx) => {
          const Icon = card.icon;
          const colorName = card.color;

          return (
            <Link key={card.title + idx} href={card.href} className="block group h-[160px] lg:h-[180px] tap-responsive outline-none">
              <V2Card hoverColor={colorName} className="flex flex-col h-full bg-white/40 dark:bg-black/20 p-5 rounded-3xl border border-white/20 dark:border-white/5 backdrop-blur-2xl shadow-xl transition-all hover:-translate-y-1 overflow-hidden">
                 <Sparkline colorClass={`text-${colorName}-500`} variant={card.variant} />
                 <MonolithicWatermark value={loading ? 0 : card.value} className="opacity-40" />

                 <div className="relative z-10 flex flex-col h-full justify-between">
                   <div className="flex justify-between items-start">
                     <h3 className={cn("text-[10px] font-mono tracking-widest uppercase w-2/3 leading-snug flex items-center gap-2", `text-${colorName}-600 dark:text-${colorName}-400`)}>
                       {card.title}
                     </h3>
                     <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center group-hover:bg-opacity-20 transition-colors border", `border-${colorName}-500/20 text-${colorName}-600 dark:text-${colorName}-400 bg-${colorName}-500/10 shadow-inner`)}>
                       <Icon className="w-4 h-4" />
                     </div>
                   </div>
                   
                   <div className="flex flex-col">
                     <span className={cn("text-4xl lg:text-5xl font-mono tracking-tighter tabular-nums pb-1 leading-none text-slate-800 dark:text-slate-100 group-hover:text-transparent group-hover:bg-clip-text transition-all duration-300", `group-hover:bg-gradient-to-b group-hover:from-${colorName}-600 group-hover:to-${colorName}-400 dark:group-hover:from-${colorName}-300 dark:group-hover:to-${colorName}-500`)}>
                        {loading ? "-" : card.value.toLocaleString()}
                     </span>
                     <span className="text-[9px] uppercase tracking-widest font-mono text-slate-500 dark:text-slate-400 mt-1">
                        {card.hint}
                     </span>
                   </div>
                 </div>
              </V2Card>
            </Link>
          );
        })}
      </KineticGrid>
      </div>
    </div>
  );
}
