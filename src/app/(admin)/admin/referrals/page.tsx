"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, UserPlus, ArrowRight } from "lucide-react";

import { ReferralsHubNav } from "./referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type LeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  "id" | "first_name" | "last_name" | "status" | "updated_at"
> & {
  referral_sources: { name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminReferralsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState({
    new: 0,
    pipeline: 0,
    converted: 0,
    attention: 0,
  });
  const [hl7Counts, setHl7Counts] = useState({ pending: 0, failed: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ new: 0, pipeline: 0, converted: 0, attention: 0 });
      setHl7Counts({ pending: 0, failed: 0 });
      setLoading(false);
      return;
    }

    try {
      const { data: list, error: listErr } = await supabase
        .from("referral_leads")
        .select("id, first_name, last_name, status, updated_at, referral_sources(name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (listErr) throw listErr;
      setRows((list ?? []) as LeadRow[]);

      const base = () =>
        supabase
          .from("referral_leads")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const hl7Base = () =>
        supabase
          .from("referral_hl7_inbound")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cNew, cConv, cAtt, cPipe, hl7Pending, hl7Failed] = await Promise.all([
        base().eq("status", "new"),
        base().eq("status", "converted"),
        base().in("status", ["new", "contacted"]),
        supabase
          .from("referral_leads")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("status", "in", "(converted,lost,merged)"),
        hl7Base().eq("status", "pending"),
        hl7Base().eq("status", "failed"),
      ]);

      setCounts({
        new: cNew.count ?? 0,
        pipeline: cPipe.count ?? 0,
        converted: cConv.count ?? 0,
        attention: cAtt.count ?? 0,
      });
      setHl7Counts({
        pending: hl7Pending.count ?? 0,
        failed: hl7Failed.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load referrals.");
      setRows([]);
      setHl7Counts({ pending: 0, failed: 0 });
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12 w-full">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Module 22
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Referral CRM
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Inquiries and pipeline before admission — source attribution and conversion.
           </p>
         </div>
         <div className="hidden md:block">
           <ReferralsHubNav />
         </div>
      </div>

      {noFacility ? (
        <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm">
           <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <span className="font-bold">!</span>
           </div>
           Select a facility in the header to load referral leads and metrics.
        </div>
      ) : null}

      {/* ─── METRIC PILLARS ─── */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 pt-4">
        <div className="h-[180px]">
           <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                 New Leads
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.new}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                 Active Pipeline
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.pipeline}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="blue" className="border-blue-500/20 shadow-[0_8px_30px_rgba(59,130,246,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-blue-600 dark:text-blue-400 flex items-center gap-2">
                 Converted
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.converted}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                 Needs Attention
               </h3>
               <div className="flex items-center gap-3">
                 <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                   {noFacility ? "—" : loading ? "—" : counts.attention}
                 </p>
               </div>
             </div>
           </V2Card>
        </div>
      </div>

      <div className="h-[120px]">
        <V2Card href="/admin/referrals/new" hoverColor="indigo" className="border-indigo-500/20 pb-0">
          <div className="flex items-center gap-6 h-full absolute inset-0 px-8">
            <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 p-4 border border-indigo-100 dark:border-indigo-500/20">
              <UserPlus className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-display text-xl lg:text-2xl font-medium tracking-tight text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                New Prospect Lead
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 tracking-wide mt-1">Add an inquiry directly to the chosen facility pipeline.</p>
            </div>
            <ArrowRight className="h-6 w-6 text-slate-300 dark:text-slate-700 ml-auto group-hover:text-indigo-500 transition-colors group-hover:translate-x-2 duration-300" />
          </div>
        </V2Card>
      </div>

      {!noFacility ? (
        <div className="glass-panel border-amber-200/60 dark:border-amber-500/20 rounded-[2rem] bg-amber-50/50 dark:bg-amber-950/20 shadow-sm backdrop-blur-3xl overflow-hidden p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-base font-bold text-slate-900 dark:text-white mb-1 tracking-tight">HL7 ADT Inbound Queue</p>
            <p className="text-sm text-slate-600 dark:text-zinc-400 tracking-wide">
              {loading
                ? "Loading queue counts…"
                : `Pending ${hl7Counts.pending} · Failed ${hl7Counts.failed} for this facility. Open the queue for processed and ignored messages.`}
            </p>
          </div>
          <Link
            href="/admin/referrals/hl7-inbound"
            className={cn(buttonVariants({ variant: "outline" }), "shrink-0 shadow-sm rounded-full bg-white dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 w-full sm:w-auto px-6 tap-responsive font-bold uppercase tracking-widest text-xs")}
          >
            Review Pipeline
          </Link>
        </div>
      ) : null}

      {/* ─── CASE ROSTER (GLASS ROWS) ─── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white tracking-tight">
            Pipeline Leads
          </h3>
        </div>

        {loadError ? (
           <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">{loadError}</p>
        ) : null}

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-sm backdrop-blur-3xl overflow-hidden p-4 md:p-6 lg:p-8">
           
           <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5">
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Lead Name</div>
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Source</div>
             <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
           </div>

           <div className="space-y-3 mt-4">
             {noFacility ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Select a facility to view leads.
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading pipeline...
               </div>
             ) : rows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No leads yet. Starts with <strong>New lead</strong>.
               </div>
             ) : (
                rows.map((r) => {
                  const isNew = r.status.includes('new');
                  
                  return (
                    <Link
                      key={r.id} 
                      href={`/admin/referrals/${r.id}`}
                      className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center p-5 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-colors w-full cursor-pointer outline-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                          {isNew ? <PulseDot colorClass="bg-emerald-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                        </div>
                        <span className="font-semibold text-lg text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors tracking-tight">
                           {r.first_name} {r.last_name}
                        </span>
                      </div>
                      
                      <div className="flex flex-row justify-between lg:justify-start items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Status</span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded border leading-none pt-1",
                          isNew ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400" : "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400"
                        )}>
                          {formatStatus(r.status)}
                        </span>
                      </div>
                      
                      <div className="flex flex-row justify-between lg:justify-end items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Source</span>
                        <span className="text-sm font-medium text-slate-700 dark:text-zinc-300 truncate">
                          {r.referral_sources?.name ?? "—"}
                        </span>
                      </div>

                      <div className="flex flex-row justify-between lg:justify-end items-center">
                        <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Updated</span>
                        <span className="text-sm font-medium text-slate-500 dark:text-zinc-500">
                          {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </div>
                    </Link>
                  )
                })
             )}
           </div>
        </div>
      </div>

    </div>
  );
}
