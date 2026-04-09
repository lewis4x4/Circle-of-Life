"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type SavedView = {
  id: string;
  name: string;
  template_id: string;
  template_version_id: string;
  sharing_scope: string;
  pinned_template_version: boolean;
  updated_at: string;
  archived_at: string | null;
};

export default function SavedReportsPage() {
  const supabase = createClient();
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(PHASE1_TEMPLATE_SEED[0]?.slug ?? "");

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
        .from("report_saved_views")
        .select("id, name, template_id, template_version_id, sharing_scope, pinned_template_version, updated_at, archived_at")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setViews((data ?? []) as SavedView[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load saved reports.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const templateNameById = useMemo(() => {
    const m = new Map<string, string>();
    PHASE1_TEMPLATE_SEED.forEach((template) => m.set(template.slug, template.name));
    return m;
  }, []);

  async function onCreate() {
    if (!orgId || !userId) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    const { data: template, error: templateErr } = await supabase
      .from("report_templates")
      .select("id")
      .eq("slug", selectedTemplate)
      .is("deleted_at", null)
      .maybeSingle();
    if (templateErr || !template?.id) {
      setError(templateErr?.message ?? "Template not found.");
      return;
    }
    const { data: version, error: versionErr } = await supabase
      .from("report_template_versions")
      .select("id")
      .eq("template_id", template.id)
      .is("deleted_at", null)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionErr || !version?.id) {
      setError(versionErr?.message ?? "Template version not found.");
      return;
    }

    const { error: insertErr } = await supabase.from("report_saved_views").insert({
      organization_id: orgId,
      owner_user_id: userId,
      template_id: template.id,
      template_version_id: version.id,
      sharing_scope: "private",
      name: name.trim(),
      pinned_template_version: true,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setName("");
    await load();
  }

  async function onArchive(id: string) {
    if (!orgId) return;
    const { error: archiveErr } = await supabase
      .from("report_saved_views")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", orgId);
    if (archiveErr) {
      setError(archiveErr.message);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-emerald-700/5"
        secondaryClass="bg-slate-900/5"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Saved Reports
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Manage pinned or inheriting variants with role-safe sharing and version awareness.
            </p>
          </div>
        </header>

      {error && <p className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium max-w-7xl mx-auto">{error}</p>}

      {canManage && (
        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible mb-6 z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Create Saved Variant</h3>
            <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400 mt-1">Create from template and pin to current version.</p>
          </div>
          <div className="grid gap-4 flex-col lg:flex-row lg:grid-cols-[2fr_1fr_auto] items-center">
            <input className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-black/30 px-5 py-2 text-sm backdrop-blur-xl shadow-inner focus-visible:ring-indigo-500 font-mono tracking-wide" placeholder="Variant name" value={name} onChange={(event) => setName(event.target.value)} />
            <div className="w-full relative">
              <select
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white/60 px-5 py-2 text-sm dark:border-white/10 dark:bg-black/30 backdrop-blur-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-mono uppercase tracking-widest text-[11px] font-bold text-slate-700 dark:text-slate-200"
                value={selectedTemplate}
                onChange={(event) => setSelectedTemplate(event.target.value)}
              >
                {PHASE1_TEMPLATE_SEED.map((template) => (
                  <option key={template.slug} value={template.slug} className="dark:bg-slate-900 font-sans capitalize tracking-normal text-sm font-medium">
                    {template.name}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400 font-bold">
                 ↓
              </div>
            </div>
            <Button className="rounded-2xl font-mono uppercase tracking-widest text-[11px] font-bold h-12 w-full lg:w-auto hover:-translate-y-0.5 transition-transform shadow-lg px-10" onClick={() => void onCreate()}>
              Save Variant
            </Button>
          </div>
        </div>
      )}

      <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">My and Shared Variants</h3>
          </div>
          {loading ? (
            <div className="p-16 text-center text-slate-500">
               <p className="text-sm font-mono tracking-widest uppercase">Loading Variants…</p>
            </div>
          ) : views.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Saved Variants</p>
               <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">You haven&apos;t pinned any custom report configurations yet.</p>
             </div>
          ) : (
            <MotionList className="space-y-4">
                {views.map((view) => (
                  <MotionItem key={view.id}>
                    <div className="p-6 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-default border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] w-full flex flex-col xl:flex-row xl:items-center justify-between gap-6 backdrop-blur-xl shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                        <div className="flex flex-col min-w-[250px] gap-1 shrink-0">
                           <span className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-wide">
                              {view.name}
                           </span>
                           <span className="text-[10px] font-mono tracking-widest uppercase text-slate-500 dark:text-slate-400">
                              Template: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{templateNameById.get(view.template_id) ?? "Mapped template"}</span>
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 w-full items-center">
                           <div className="flex flex-col gap-2">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Sharing</span>
                              <Badge className="bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border border-slate-200 dark:border-white/10 shadow-sm px-2.5 py-1 rounded-full w-fit">
                                {view.sharing_scope}
                              </Badge>
                           </div>
                           <div className="flex flex-col gap-2 align-left md:text-left">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Version Config</span>
                              {view.pinned_template_version ? (
                                <Badge className="bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full w-fit">
                                  Pinned
                                </Badge>
                              ) : (
                                <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full w-fit">
                                  Live Updates
                                </Badge>
                              )}
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Last Modified</span>
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 font-medium">{new Date(view.updated_at).toLocaleString()}</span>
                           </div>
                        </div>

                        <div className="flex shrink-0 xl:ml-4 gap-3 mt-4 xl:mt-0">
                           <Link href={`/admin/reports/run/saved_view/${view.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "font-mono uppercase tracking-widest text-[10px] h-10 rounded-xl font-bold bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 w-full lg:w-auto px-6 hover:bg-slate-50 dark:hover:bg-white/10 shadow-sm transition-colors")}>
                             Run Report
                           </Link>
                           <Button variant="ghost" size="sm" onClick={() => void onArchive(view.id)} className="font-mono uppercase tracking-widest text-[10px] h-10 rounded-xl font-bold border-transparent hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 px-6 w-full lg:w-auto transition-colors">
                             Archive
                           </Button>
                        </div>
                    </div>
                  </MotionItem>
                ))}
            </MotionList>
          )}
      </div>
      </div>
    </div>
  );
}
