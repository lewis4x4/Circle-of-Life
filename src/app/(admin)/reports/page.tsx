"use client";

import { useEffect, useMemo, useState } from "react";
import { Fingerprint, Layers, Clock, FolderOpen, Save, type LucideIcon } from "lucide-react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { createClient } from "@/lib/supabase/client";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { cn } from "@/lib/utils";
import Link from "next/link";

type CountCard = { title: string; value: number; hint: string; icon: LucideIcon; color: string; href: string };

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
              href: "/admin/reports/templates"
            },
            {
              title: "Saved Reports",
              value: savedRes.count ?? 0,
              hint: "Pinned or inherited variants",
              icon: Save,
              color: "emerald",
              href: "/admin/reports/saved"
            },
            {
              title: "Active Schedules",
              value: schedulesRes.count ?? 0,
              hint: "Recurring report jobs",
              icon: Clock,
              color: "amber",
              href: "/admin/reports/scheduled"
            },
            {
              title: "Report Packs",
              value: packsRes.count ?? 0,
              hint: "Executive & compliance bundles",
              icon: FolderOpen,
              color: "rose",
              href: "/admin/reports/packs"
            },
            {
              title: "Run History",
              value: runsRes.count ?? 0,
              hint: "Executed report runs audit log",
              icon: Layers,
              color: "blue",
              href: "/admin/reports/history"
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
        href: "#"
      })),
    []
  );

  const colors = {
    indigo: "from-indigo-500/20 border-indigo-500/30 text-indigo-400 bg-indigo-500/10",
    emerald: "from-emerald-500/20 border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    amber: "from-amber-500/20 border-amber-500/30 text-amber-400 bg-amber-500/10",
    rose: "from-rose-500/20 border-rose-500/30 text-rose-400 bg-rose-500/10",
    blue: "from-blue-500/20 border-blue-500/30 text-blue-400 bg-blue-500/10",
    slate: "from-slate-500/20 border-slate-500/30 text-slate-400 bg-slate-500/10",
  } as const;

  return (
    <div className="space-y-10 pb-12 w-full max-w-[1600px] mx-auto">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
        <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Intelligence
           </div>
           <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Reporting Hub
           </h1>
           <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
             Template-first reporting with scheduling, packs, and audited exports.
           </p>
        </div>
        <div className="hidden md:block">
           <ReportsHubNav />
        </div>
      </div>

      {error && (
         <div className="rounded-[1.5rem] border border-rose-800/60 bg-rose-950/40 p-6 text-sm text-rose-200 font-medium tracking-wide flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/30">
               <span className="font-bold">!</span>
            </div>
            {error}
         </div>
      )}

      {/* ─── METRIC PILLARS ─── */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 xl:gap-8 pt-4 lg:px-4">
        {(loading ? placeholderCards : orderedCards).map((card, idx) => {
          const Icon = card.icon;
          const tone = colors[card.color as keyof typeof colors] || colors.slate;

          return (
            <Link key={card.title + idx} href={card.href} className="block group tap-responsive outline-none">
               <div className={cn(
                 "relative h-[240px] w-full overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white/60 backdrop-blur-3xl p-8 transition-all duration-500 flex flex-col justify-between",
                 "dark:border-white/5 dark:bg-white/[0.015] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]",
                 "hover:-translate-y-2 hover:shadow-2xl dark:hover:border-white/10 dark:hover:bg-white/[0.03]"
               )}>
                  {/* Subtle top glare */}
                  <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  
                  {/* Radial bloom via pseudo-element mapped to color */}
                  <div className={`absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none mix-blend-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] ${tone.split(' ')[0]} via-transparent to-transparent`} />
                  
                  <div className="relative z-10 flex items-start justify-between">
                     <span className="text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 w-[60%] leading-relaxed">
                        {card.title}
                     </span>
                     <div className={`w-14 h-14 rounded-[1rem] flex items-center justify-center border shadow-inner ${tone.split(' ').slice(1).join(' ')}`}>
                        <Icon className="w-6 h-6" />
                     </div>
                  </div>
                  
                  <div className="relative z-10 flex flex-col gap-2 mt-auto">
                     <span className="text-6xl md:text-7xl font-display font-medium tabular-nums tracking-tight text-slate-900 dark:text-white leading-none">
                        {loading ? "-" : card.value.toLocaleString()}
                     </span>
                     <span className="text-sm font-semibold text-slate-500 dark:text-zinc-500 tracking-wide">
                        {card.hint}
                     </span>
                  </div>
               </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
