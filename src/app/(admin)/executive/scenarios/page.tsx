"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { AdminFacilityScopeDropdown } from "@/components/common/admin-facility-scope-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Presentation, Loader2, Plus, Globe, Building2 } from "lucide-react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type ScenarioRow = Database["public"]["Tables"]["exec_scenarios"]["Row"] & {
  facilities: { name: string } | null;
};

export default function ExecutiveScenariosPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [facilityNames, setFacilityNames] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeFacilityId, setScopeFacilityId] = useState<string | null>(null);
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
      const [facList, { data, error: qErr }] = await Promise.all([
        fetchAdminFacilityOptions(),
        supabase
          .from("exec_scenarios")
          .select("*, facilities(name)")
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(50),
      ]);
      setFacilityNames(facList.map((f) => ({ id: f.id, name: f.name })));
      if (qErr) throw qErr;
      setRows((data ?? []) as ScenarioRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scenarios.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createScenario(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const facilityId =
        scopeFacilityId !== null && isValidFacilityIdForQuery(scopeFacilityId)
          ? scopeFacilityId
          : null;
      const { error: insErr } = await supabase.from("exec_scenarios").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: facilityId,
        name: n,
        description: description.trim() || null,
        created_by: user.id,
        assumptions: {},
      });
      if (insErr) throw insErr;
      setName("");
      setDescription("");
      setScopeFacilityId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create scenario.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId)) {
      setScopeFacilityId(selectedFacilityId);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    if (loading) return;
    if (
      scopeFacilityId !== null &&
      !facilityNames.some((f) => f.id === scopeFacilityId)
    ) {
      setScopeFacilityId(null);
    }
  }, [loading, facilityNames, scopeFacilityId]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto px-4 sm:px-6">
        <ExecutiveHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Scenarios
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-balance">
               What-if assumption bundles for portfolio modeling. Solvers and NLQ links are Enhanced.
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
            Scenarios are available to organization owners and org admins.
          </div>
        )}

        {canUse && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-6">
            <div className="border-indigo-500/20 dark:border-indigo-500/10 rounded-[2.5rem] bg-indigo-50/50 dark:bg-indigo-900/10 shadow-sm backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative h-fit order-last xl:order-first">
               <div className="mb-6 border-b border-indigo-200/50 dark:border-white/5 pb-4 flex flex-col gap-1">
                  <h3 className="text-xl font-display font-semibold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                    <Plus className="h-5 w-5 text-indigo-500" /> New Scenario
                  </h3>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-indigo-700/60 dark:text-indigo-400/60">
                     Organization-wide or isolated
                  </p>
               </div>
               
               <form onSubmit={createScenario} className="space-y-4">
                  <div className="space-y-1.5 focus-within:text-indigo-600 dark:focus-within:text-indigo-400">
                    <Label htmlFor="sc-name" className="text-xs uppercase tracking-widest font-bold text-slate-500 inherit-text">Name</Label>
                    <Input
                      id="sc-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={200}
                      placeholder="e.g. +3% private-pay rate"
                      className="h-12 bg-white/70 dark:bg-black/20 border-slate-200 dark:border-white/10 rounded-xl focus-visible:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-1.5 focus-within:text-indigo-600 dark:focus-within:text-indigo-400">
                    <Label htmlFor="sc-desc" className="text-xs uppercase tracking-widest font-bold text-slate-500 inherit-text">Description <span className="opacity-50 font-normal normal-case tracking-normal ml-1">(Optional)</span></Label>
                    <textarea
                      id="sc-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                      placeholder="Notes for your team"
                      className={cn(
                        "min-h-[80px] w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm outline-none resize-none",
                        "focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                      )}
                    />
                  </div>
                  <div className="space-y-1.5 focus-within:text-indigo-600 dark:focus-within:text-indigo-400">
                    <Label htmlFor="sc-scope" className="text-xs uppercase tracking-widest font-bold text-slate-500 inherit-text">Scope</Label>
                    <AdminFacilityScopeDropdown
                      id="sc-scope"
                      aria-label="Scenario scope"
                      value={scopeFacilityId}
                      onChange={setScopeFacilityId}
                      facilities={facilityNames}
                      loading={loading}
                      disabled={saving}
                      triggerClassName="rounded-xl border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20"
                    />
                  </div>
                  <Button type="submit" disabled={saving || !name.trim()} className="w-full h-12 rounded-xl font-bold tracking-widest uppercase text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white shadow mt-2">
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Create Scenario"
                    )}
                  </Button>
               </form>
            </div>

            <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-slate-50/50 dark:bg-white/[0.02] shadow-sm backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
                <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                     <Presentation className="h-5 w-5 text-indigo-500" /> Saved Scenarios
                  </h3>
                  <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Order by updated</p>
                </div>

                <div className="relative z-10 w-full overflow-hidden">
                  {loading ? (
                    <div className="flex items-center justify-center p-12 text-sm text-slate-500 font-medium">
                       <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Scenarios...
                    </div>
                  ) : (
                    <>
                      <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Name</div>
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Scope</div>
                         <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
                      </div>

                      <div className="space-y-3 mt-6 relative z-10">
                         <MotionList className="space-y-3">
                            {rows.length === 0 ? (
                              <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium bg-white/50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                                 No scenarios yet.
                              </div>
                            ) : (
                               rows.map((row) => (
                                <MotionItem key={row.id}>
                                   <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                     <div className="flex flex-col">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Name</span>
                                        <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{row.name}</span>
                                        {row.description && (
                                           <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{row.description}</span>
                                        )}
                                     </div>
                                     <div className="flex flex-col">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Scope</span>
                                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                                           {row.facility_id ? <><Building2 className="w-3.5 h-3.5 opacity-60" /> {row.facilities?.name ?? row.facility_id}</> : <><Globe className="w-3.5 h-3.5 opacity-60" /> Organization</>}
                                        </span>
                                     </div>
                                     <div className="flex flex-col sm:items-end">
                                        <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Updated</span>
                                        <span className="text-sm font-mono text-slate-600 dark:text-slate-400">
                                           {format(new Date(row.updated_at), "MMM d, yyyy")}
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
