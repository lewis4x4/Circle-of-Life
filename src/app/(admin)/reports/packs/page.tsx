"use client";

import { useCallback, useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type Pack = {
  id: string;
  name: string;
  category: string;
  official_pack: boolean;
  locked_definition: boolean;
  active: boolean;
  created_at: string;
};

export default function ReportPacksPage() {
  const supabase = createClient();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("operational");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setOrgId(ctx.ctx.organizationId);
      setUserId(ctx.ctx.userId);
      setCanManage(canManageReports(ctx.ctx.appRole));

      const { data, error: queryErr } = await supabase
        .from("report_packs")
        .select("id, name, category, official_pack, locked_definition, active, created_at")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setPacks((data ?? []) as Pack[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report packs.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreatePack() {
    if (!orgId || !userId) return;
    if (!name.trim()) {
      setError("Pack name is required.");
      return;
    }
    const { error: insertErr } = await supabase.from("report_packs").insert({
      organization_id: orgId,
      name: name.trim(),
      category,
      owner_scope: "organization",
      official_pack: false,
      locked_definition: false,
      active: true,
      created_by: userId,
      updated_by: userId,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setName("");
    await load();
  }

  async function onCreateSurveyPack() {
    if (!orgId || !userId) return;
    const { error: insertErr } = await supabase.from("report_packs").insert({
      organization_id: orgId,
      name: "Survey Visit Pack",
      description: "One-click survey packet bundle.",
      category: "survey",
      owner_scope: "organization",
      official_pack: true,
      locked_definition: true,
      active: true,
      created_by: userId,
      updated_by: userId,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    await load();
  }

  return (
    <>
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-rose-700/5"
        secondaryClass="bg-slate-900/5"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Report Packs
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Curate recurring executive, compliance, and survey-ready report bundles.
            </p>
          </div>
        </header>
      {error && <p className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium max-w-7xl mx-auto">{error}</p>}

      {canManage && (
        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible mb-6 z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Create Pack</h3>
            <p className="text-sm font-mono tracking-wide mt-1 text-slate-500 dark:text-slate-400">Start with role-based or event-based bundles.</p>
          </div>
          <div className="grid gap-4 flex-col lg:flex-row lg:grid-cols-[2fr_1fr_auto] items-center">
            <input className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-black/30 px-5 py-2 text-sm backdrop-blur-xl shadow-inner focus-visible:ring-indigo-500 font-mono tracking-wide" placeholder="Pack name (e.g. CEO Weekly Pack)" value={name} onChange={(event) => setName(event.target.value)} />
            <div className="w-full relative">
              <select
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white/60 px-5 py-2 text-sm dark:border-white/10 dark:bg-black/30 backdrop-blur-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-mono uppercase tracking-widest text-[11px] font-bold text-slate-700 dark:text-slate-200"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="operational" className="dark:bg-slate-900 font-sans tracking-normal capitalize text-sm font-medium">Operational</option>
                <option value="board" className="dark:bg-slate-900 font-sans tracking-normal capitalize text-sm font-medium">Board</option>
                <option value="survey" className="dark:bg-slate-900 font-sans tracking-normal capitalize text-sm font-medium">Survey</option>
                <option value="compliance" className="dark:bg-slate-900 font-sans tracking-normal capitalize text-sm font-medium">Compliance</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400 font-bold">
                 ↓
              </div>
            </div>
            <div className="flex w-full lg:w-auto gap-2">
              <Button className="rounded-2xl font-mono uppercase tracking-widest text-[11px] font-bold h-12 hover:-translate-y-0.5 transition-transform shadow-lg px-8 flex-1" onClick={() => void onCreatePack()}>
                Create
              </Button>
              <Button variant="outline" className="rounded-2xl font-mono uppercase tracking-widest text-[11px] font-bold h-12 hover:-translate-y-0.5 transition-transform shadow-sm flex-1 bg-white/50 dark:bg-white/5" onClick={() => void onCreateSurveyPack()}>
                Survey Visit Pack
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Pack Registry</h3>
          </div>
          {loading ? (
            <div className="p-16 text-center text-slate-500">
               <p className="text-sm font-mono tracking-widest uppercase">Loading Packs…</p>
            </div>
          ) : packs.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Packs Configured</p>
               <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">Bundle reports together into curated packs.</p>
             </div>
          ) : (
            <MotionList className="space-y-4">
                {packs.map((pack) => (
                  <MotionItem key={pack.id}>
                    <div className="p-6 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-default border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] w-full flex flex-col xl:flex-row xl:items-center justify-between gap-6 backdrop-blur-xl shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                        <div className="flex flex-col min-w-[200px] gap-1 shrink-0">
                           <span className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-wide">
                              {pack.name}
                           </span>
                           <span className="text-[10px] font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                              Category: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{pack.category}</span>
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-2 gap-6 w-full items-center">
                           <div className="flex flex-col gap-2">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Properties</span>
                              <div className="flex flex-wrap gap-2">
                                {pack.official_pack && <Badge className="bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Official</Badge>}
                                {pack.locked_definition && <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Locked</Badge>}
                                {!pack.active ? (
                                  <Badge className="bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Inactive</Badge>
                                ) : (
                                  <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">Active</Badge>
                                )}
                              </div>
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Operations</span>
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tracking-wide uppercase">Pack enhancements in governance flow.</span>
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
