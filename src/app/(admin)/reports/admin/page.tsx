"use client";

import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  official_template: boolean;
  locked_definition: boolean;
  updated_at: string;
};

export default function ReportsGovernancePage() {
  const supabase = createClient();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        setCanManage(canManageReports(ctx.ctx.appRole));
        const { data, error: queryErr } = await supabase
          .from("report_templates")
          .select("id, name, slug, status, official_template, locked_definition, updated_at")
          .is("deleted_at", null)
          .order("updated_at", { ascending: false });
        if (queryErr) throw new Error(queryErr.message);
        if (alive) setRows((data ?? []) as TemplateRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load governance templates.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  return (
    <>
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-purple-700/5"
        secondaryClass="bg-slate-900/5"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Template Governance
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Control official templates, locking, deprecation, and report permissions.
            </p>
          </div>
        </header>

      {error && <p className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium max-w-7xl mx-auto">{error}</p>}
      
      {!canManage && (
         <div className="glass-panel rounded-[1.5rem] border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-600 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
               <span className="font-bold">!</span>
            </div>
            Governance actions are restricted to administrator and system roles.
         </div>
      )}
      <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Template Registry</h3>
            <p className="text-sm font-mono tracking-wide mt-1 text-slate-500 dark:text-slate-400">Official/locked metadata and lifecycle status.</p>
          </div>
          {loading ? (
            <div className="p-16 text-center text-slate-500">
               <p className="text-sm font-mono tracking-widest uppercase">Loading Registry…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Templates Found</p>
               <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">Contact support to provision your organization&apos;s templates.</p>
             </div>
          ) : (
            <MotionList className="space-y-4">
                {rows.map((row) => (
                  <MotionItem key={row.id}>
                    <div className="p-6 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-default border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] w-full flex flex-col xl:flex-row xl:items-center justify-between gap-6 backdrop-blur-xl shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                        <div className="flex flex-col min-w-[300px] gap-1 shrink-0">
                           <span className="font-bold text-slate-900 dark:text-slate-100 uppercase text-sm tracking-wide">
                              {row.name}
                           </span>
                           <span className="text-[10px] font-mono tracking-widest text-slate-500 dark:text-slate-400">
                              Slug: <span className="font-semibold text-purple-600 dark:text-purple-400">{row.slug}</span>
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full items-center">
                           <div className="flex flex-col gap-2 md:col-span-2">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Directives</span>
                              <div className="flex flex-wrap gap-2">
                                {row.official_template ? (
                                  <Badge className="bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Official</Badge>
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-700 dark:bg-black/40 dark:text-slate-300 border border-slate-200 dark:border-white/10 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Custom</Badge>
                                )}
                                {row.locked_definition && (
                                  <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Locked</Badge>
                                )}
                              </div>
                           </div>
                           <div className="flex flex-col gap-2 align-left md:text-left">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Status</span>
                              <span className="font-mono text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest">{row.status}</span>
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Last Updated</span>
                              <span className="font-mono text-[11px] font-medium text-slate-600 dark:text-slate-400 tracking-wide">{new Date(row.updated_at).toLocaleString()}</span>
                           </div>
                        </div>
                    </div>
                  </MotionItem>
                ))}
            </MotionList>
          )}
      </div>
      </div>
    </>
  );
}
