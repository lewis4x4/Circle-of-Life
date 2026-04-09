"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Link as LinkIcon, Plus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type NlqRow = Database["public"]["Tables"]["exec_nlq_sessions"]["Row"];

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function ExecutiveNlqPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<NlqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [canUse, setCanUse] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        setCanUse(false);
        return;
      }
      const role = ctx.ctx.appRole;
      const allowed = role === "owner" || role === "org_admin";
      setCanUse(allowed);
      if (!allowed) {
        setRows([]);
        return;
      }
      const { data, error: qErr } = await supabase
        .from("exec_nlq_sessions")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load NLQ sessions.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: insErr } = await supabase.from("exec_nlq_sessions").insert({
        organization_id: ctx.ctx.organizationId,
        user_id: user.id,
        created_by: user.id,
        title: t,
        status: "draft",
      });
      if (insErr) throw insErr;
      setTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create session.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto px-4 sm:px-6">
        <ExecutiveHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Natural Language Queries
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-balance">
               Session log for executive NLQ attempts. Optional links to <code className="rounded bg-white/50 dark:bg-white/10 px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-widest text-slate-500 dark:text-slate-300">ai_invocations</code> are populated when an Edge Function or app flow records a model call (Enhanced).
            </p>
          </div>
        </header>

        {error && (
          <div className="p-6 rounded-[2.5rem] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-medium z-10 relative">
            {error}
          </div>
        )}

        {!canUse && !loading && (
          <div className="p-12 text-center text-amber-700 dark:text-amber-400 text-sm font-medium bg-amber-50 dark:bg-amber-900/20 rounded-[2.5rem] border border-amber-200 dark:border-amber-500/20 backdrop-blur-3xl z-10 relative">
            NLQ sessions are available to organization owners and org admins.
          </div>
        )}

        {canUse && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 border-indigo-500/20 dark:border-indigo-500/10 rounded-[2.5rem] bg-indigo-50/50 dark:bg-indigo-900/10 shadow-sm backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative h-fit order-last lg:order-first">
               <div className="mb-6 border-b border-indigo-200/50 dark:border-white/5 pb-4 flex flex-col gap-1">
                  <h3 className="text-xl font-display font-semibold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                    <Plus className="h-5 w-5 text-indigo-500" /> New Session
                  </h3>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-indigo-700/60 dark:text-indigo-400/60">
                     Add a titled draft. Pipeline is enhanced.
                  </p>
               </div>
               
               <form onSubmit={createSession} className="space-y-4">
                  <div className="space-y-1.5 focus-within:text-indigo-600 dark:focus-within:text-indigo-400">
                    <Label htmlFor="nlq-title" className="text-xs uppercase tracking-widest font-bold text-slate-500 inherit-text">Title</Label>
                    <Input
                      id="nlq-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. AR aging vs last quarter"
                      maxLength={500}
                      className="h-12 bg-white/70 dark:bg-black/20 border-slate-200 dark:border-white/10 rounded-xl focus-visible:ring-indigo-500"
                    />
                  </div>
                  <Button type="submit" disabled={saving || !title.trim()} className="w-full h-12 rounded-xl font-bold tracking-widest uppercase text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white shadow">
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Create Draft"
                    )}
                  </Button>
               </form>
            </div>

            <div className="lg:col-span-2 glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-slate-50/50 dark:bg-white/[0.02] shadow-sm backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
                <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                     <MessageSquare className="h-5 w-5 text-indigo-500" /> Recent Sessions
                  </h3>
                  <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Most recent first</p>
                </div>

                <div className="relative z-10 w-full overflow-hidden">
                  {loading ? (
                    <div className="flex items-center justify-center p-12 text-sm text-slate-500 font-medium">
                       <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Sessions...
                    </div>
                  ) : (
                    <>
                      <div className="hidden sm:grid grid-cols-[2fr_1fr_1.5fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Title</div>
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">AI Invocation</div>
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Created</div>
                      </div>

                      <div className="space-y-3 mt-6 relative z-10">
                         <MotionList className="space-y-3">
                            {rows.length === 0 ? (
                              <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium bg-white/50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                                 No NLQ sessions yet.
                              </div>
                            ) : (
                               rows.map((row) => (
                                <MotionItem key={row.id}>
                                   <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1.5fr_1fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                     <div className="flex flex-col">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Title</span>
                                        <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{row.title}</span>
                                     </div>
                                     <div className="flex flex-col">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Status</span>
                                        <Badge className="capitalize w-fit bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-none shadow-none text-[10px] uppercase font-bold tracking-widest">
                                           {formatStatus(row.status)}
                                        </Badge>
                                     </div>
                                     <div className="flex flex-col">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">AI Invocation</span>
                                        <span className="text-xs font-mono text-slate-600 dark:text-slate-400 flex items-center gap-1.5 max-w-[150px] truncate">
                                          {row.ai_invocation_id ? <><LinkIcon className="h-3 w-3 opacity-50" /> {row.ai_invocation_id}</> : "—"}
                                        </span>
                                     </div>
                                     <div className="flex flex-col sm:items-end">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Created</span>
                                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                           {format(new Date(row.created_at), "MMM d, yyyy")}
                                        </span>
                                     </div>
                                   </div>
                                </MotionItem>
                               ))
                            )}
                         </MotionList>
                      </div>
                    </>
                  )}
                </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
