"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Check, Link2, Globe, Building2, User, HelpCircle, Server } from "lucide-react";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const SOURCE_TYPES = [
  { value: "hospital", label: "Hospital" },
  { value: "agency", label: "Agency" },
  { value: "family", label: "Family" },
  { value: "web", label: "Web" },
  { value: "other", label: "Other" },
] as const;

type SourceRow = {
  id: string;
  name: string;
  source_type: string;
  facility_id: string | null;
  is_active: boolean;
};

export default function AdminReferralSourcesPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>("hospital");
  const [scopeFacility, setScopeFacility] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: fac, error: facErr } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
    if (facErr || !fac?.organization_id) {
      setLoadError("Could not resolve organization for this facility.");
      setRows([]);
      setLoading(false);
      return;
    }

    const { data, error: qErr } = await supabase
      .from("referral_sources")
      .select("id, name, source_type, facility_id, is_active")
      .eq("organization_id", fac.organization_id)
      .is("deleted_at", null)
      .or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`)
      .order("name");

    if (qErr) {
      setLoadError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as SourceRow[]);
    }
    setLoading(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFormError("Select a facility in the header.");
      return;
    }
    const n = name.trim();
    if (!n) {
      setFormError("Name is required.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: fac, error: facErr } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (facErr || !fac?.organization_id) {
        setFormError("Could not resolve organization for this facility.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setFormError("You must be signed in.");
        return;
      }

      const payload = {
        organization_id: fac.organization_id,
        facility_id: scopeFacility ? selectedFacilityId : null,
        name: n,
        source_type: sourceType,
        is_active: true,
        created_by: user.id,
      };

      const { error: insErr } = await supabase.from("referral_sources").insert(payload);
      if (insErr) {
        setFormError(insErr.message);
        return;
      }
      setName("");
      setScopeFacility(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <ReferralsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Referral Sources
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-balance">
               Master list for attribution (hospital, agency, family, web, other). Ties to <code className="rounded bg-white/50 dark:bg-white/10 px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-widest text-slate-500 dark:text-slate-300">residents.referral_source_id</code> when set.
            </p>
          </div>
          <div>
            <Link
              href="/admin/referrals"
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-slate-100 hover:bg-slate-200 text-slate-900 shadow-lg flex items-center gap-2 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-white/10")}
            >
              Back to Pipeline
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <div className="lg:col-span-1 border-brand-500/20 dark:border-brand-500/10 rounded-[2.5rem] bg-brand-50/50 dark:bg-brand-900/10 shadow-sm backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative h-fit order-last lg:order-first">
             <div className="mb-6 border-b border-brand-200/50 dark:border-white/5 pb-4 flex flex-col gap-1">
                <h3 className="text-xl font-display font-semibold text-brand-900 dark:text-brand-100 flex items-center gap-2">
                  <Plus className="h-5 w-5 text-brand-500" /> Add Source
                </h3>
                <p className="text-[10px] uppercase tracking-widest font-bold text-brand-700/60 dark:text-brand-400/60">
                   Requires Owner or Org Admin
                </p>
             </div>
             
             {noFacility ? (
               <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 text-sm font-medium text-amber-800 dark:text-amber-200">
                 Select a facility in the header to manage sources.
               </div>
             ) : (
               <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
                 <div className="space-y-4">
                   <div className="space-y-1.5 focus-within:text-brand-600 dark:focus-within:text-brand-400">
                     <Label htmlFor="src-name" className="text-xs uppercase tracking-widest font-bold text-slate-500 inherit-text">Name</Label>
                     <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} required className="h-12 bg-white/70 dark:bg-black/20 border-slate-200 dark:border-white/10 rounded-xl focus-visible:ring-brand-500" />
                   </div>
                   <div className="space-y-1.5 focus-within:text-brand-600 dark:focus-within:text-brand-400">
                     <Label htmlFor="src-type" className="text-xs uppercase tracking-widest font-bold text-slate-500 inherit-text">Type</Label>
                     <select
                       id="src-type"
                       value={sourceType}
                       onChange={(e) => setSourceType(e.target.value)}
                       className="flex h-12 w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-1 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-white/10 dark:bg-black/20 dark:text-slate-100"
                     >
                       {SOURCE_TYPES.map((t) => (
                         <option key={t.value} value={t.value} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                           {t.label}
                         </option>
                       ))}
                     </select>
                   </div>
                   <label className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-white/5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
                     <div className="relative flex items-center justify-center">
                       <input
                         type="checkbox"
                         checked={scopeFacility}
                         onChange={(e) => setScopeFacility(e.target.checked)}
                         className="peer h-5 w-5 appearance-none rounded border-2 border-slate-300 dark:border-slate-600 checked:border-brand-500 checked:bg-brand-500 transition-all cursor-pointer"
                       />
                       <Check className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" />
                     </div>
                     <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Limit to current facility</span>
                   </label>
                 </div>

                 {formError && (
                   <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-xs font-semibold text-rose-600 dark:text-rose-400" role="alert">
                     {formError}
                   </div>
                 )}
                 <Button type="submit" disabled={submitting} className="w-full h-12 rounded-xl font-bold tracking-widest uppercase text-[10px] bg-brand-600 hover:bg-brand-700 text-white shadow">
                   {submitting ? (
                     <>
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                       Saving…
                     </>
                   ) : (
                     "Add Source"
                   )}
                 </Button>
               </form>
             )}
           </div>

           <div className="lg:col-span-2 glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-slate-50/50 dark:bg-white/[0.02] shadow-sm backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
              <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                   <Link2 className="h-5 w-5 text-indigo-500" /> Configured Sources
                </h3>
                <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Org & Facility Scoped</p>
              </div>

              <div className="relative z-10 w-full overflow-hidden">
                {loading ? (
                  <div className="flex items-center justify-center p-12 text-sm text-slate-500 font-medium">
                     <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Sources...
                  </div>
                ) : loadError ? (
                  <div className="p-6 rounded-[1.5rem] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-medium text-sm">
                    {loadError}
                  </div>
                ) : (
                  <>
                    <div className="hidden sm:grid grid-cols-[1.5fr_1fr_1fr_0.5fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                       <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Name</div>
                       <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Type</div>
                       <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Scope</div>
                       <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Active</div>
                    </div>

                    <div className="space-y-3 mt-6 relative z-10">
                       <MotionList className="space-y-3">
                          {rows.length === 0 ? (
                            <div className="p-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium bg-white/50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5">
                               No sources yet. Add one or ask an org admin to create channels.
                            </div>
                          ) : (
                             rows.map((r) => {
                                const TypeIcon = r.source_type === "hospital" ? Building2 : r.source_type === "agency" ? Server : r.source_type === "web" ? Globe : r.source_type === "family" ? User : HelpCircle;
                                return (
                                 <MotionItem key={r.id}>
                                    <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_0.5fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                      <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Name</span>
                                         <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{r.name}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400">Type:</span>
                                         <Badge className="bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/10 dark:hover:bg-white/20 dark:text-slate-300 border-none shadow-none text-[10px] uppercase font-bold tracking-widest">
                                            <TypeIcon className="w-3 h-3 mr-1.5 opacity-50" />
                                            {r.source_type.replace(/_/g, " ")}
                                         </Badge>
                                      </div>
                                      <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Scope</span>
                                         <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                           {r.facility_id ? "This Facility" : "Organization"}
                                         </span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Active</span>
                                         {r.is_active ? (
                                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 self-start sm:self-auto">
                                              <Check className="h-3.5 w-3.5" />
                                            </span>
                                         ) : (
                                            <span className="inline-flex h-6 px-2.5 items-center justify-center rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-widest dark:bg-white/5 dark:text-slate-400 self-start sm:self-auto">
                                              No
                                            </span>
                                         )}
                                      </div>
                                    </div>
                                 </MotionItem>
                                );
                             })
                          )}
                       </MotionList>
                    </div>
                  </>
                )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
