"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, FileText, Loader2, ShieldCheck } from "lucide-react";

import {
  fetchFamilyCarePlanOverview,
  type FamilyCarePlanOverview,
  type FamilyResidentCarePlanView,
} from "@/lib/family/family-care-plan-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

export default function FamilyCarePlanPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FamilyCarePlanOverview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }
    try {
      const result = await fetchFamilyCarePlanOverview(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setData(null);
      } else {
        setData(result.data);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load care summary.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white/60 backdrop-blur-md px-6 py-4 text-sm text-rose-800 shadow-sm max-w-lg mx-auto mt-20">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-stone-500 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-rose-400" />
        <p className="text-sm font-medium tracking-wide">Gathering care framework…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 pb-16 md:pb-0 max-w-md mx-auto text-center mt-20">
        <div className="rounded-2xl border border-rose-200 bg-white/70 backdrop-blur-xl px-4 py-6 text-sm text-rose-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <ShieldCheck className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className="w-full h-12 rounded-full bg-white text-stone-700 font-medium border border-stone-200 shadow-sm hover:bg-stone-50 transition-colors cursor-pointer tap-responsive"
          onClick={() => void load()}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="pb-8 flex flex-col items-center max-w-3xl mx-auto w-full px-4 pt-12 md:pt-20">
      <FamilySectionIntro
        active="care"
        title="Care Summary"
        description="A plain-language view of the current care approach, what the team is watching, and how support is structured day to day."
        residentSummary={data.residents.length === 1 ? data.residents[0]?.residentName : data.residents.length > 1 ? `${data.residents[0]?.residentName ?? "Your loved one"} and others` : undefined}
      />

      <div className="w-full space-y-12">
         {data.residents.length === 0 ? (
           <div className="glass-card-light rounded-[2rem] p-10 text-center border-dashed border-2 border-stone-200/50">
             <p className="text-stone-600 font-serif text-xl italic mb-2">No care plan visible yet.</p>
             <p className="text-sm text-stone-500 max-w-md mx-auto">
               Once the clinical team finalizes and publishes the care framework, it will appear here.
             </p>
           </div>
         ) : (
           data.residents.map((r) => <ResidentCareBlocks key={r.residentId} view={r} />)
         )}

         {/* VISIBILITY SCOPE FOOTER */}
         <div className="glass-card-light rounded-[2rem] p-6 md:p-8 mt-12 bg-white/70">
           <div className="mb-4 flex items-center justify-between gap-2">
             <p className="inline-flex items-center gap-2 text-sm font-semibold text-stone-800 uppercase tracking-widest">
               <ShieldCheck className="h-4 w-4 text-emerald-500" />
               How to use this page
             </p>
             <span className="px-3 py-1 rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold uppercase tracking-wider">Read-only</span>
           </div>
           <p className="mb-6 text-sm text-stone-600 leading-relaxed max-w-xl">
             This is a shared care summary, not the team&apos;s full internal clinical chart. If anything feels unclear, ask a question and they can give you more context.
           </p>
           <div className="flex flex-wrap gap-3">
             <button
               type="button"
               className="flex-1 min-w-[140px] h-12 rounded-2xl border border-stone-200 bg-white text-stone-700 font-medium hover:bg-stone-50 transition-colors shadow-sm inline-flex items-center justify-center tap-responsive"
               onClick={() => window.print()}
             >
               <FileText className="mr-2 h-4 w-4 text-stone-400" />
               Print
             </button>
             <Link
               href="/family/messages"
               className="flex-1 min-w-[140px] h-12 rounded-2xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors shadow-[0_4px_14px_rgba(0,0,0,0.1)] inline-flex items-center justify-center tap-responsive"
             >
               <ClipboardCheck className="mr-2 h-4 w-4 text-stone-300" />
               Ask A Question
             </Link>
           </div>
         </div>
      </div>
    </div>
  );
}

function ResidentCareBlocks({ view }: { view: FamilyResidentCarePlanView }) {
  return (
    <div className="space-y-6 print:break-inside-avoid w-full">
      
      {/* Resident Plan Summary Node */}
      <div className="glass-card-light rounded-[2rem] p-6 md:p-8 bg-white/70">
        <div className="mb-6 border-b border-stone-200/50 pb-6 text-center">
            <h2 className="text-2xl font-serif text-stone-800 mb-1">{view.residentName}</h2>
            <p className="text-stone-500 text-sm">Plan v{view.version} ({view.statusLabel})</p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoPill label="Last updated" value={view.lastUpdatedLabel} colored />
          <InfoPill label="Effective" value={view.effectiveDateLabel} />
          <InfoPill label="Next review due" value={view.reviewDueDateLabel} />
        </div>
        
        {view.planNotes ? (
          <div className="mt-8 pt-6 border-t border-stone-200/50">
             <p className="text-xs uppercase tracking-widest text-stone-400 font-bold mb-2">Clinical Notes</p>
             <p className="text-[15px] text-stone-700 leading-relaxed">{view.planNotes}</p>
          </div>
        ) : null}
      </div>

      {/* Plan Line Items */}
      {view.sections.length === 0 ? (
        <div className="glass-card-light rounded-[2rem] p-8 text-center bg-white/70">
          <p className="text-stone-600">No protocol lines are published on this plan yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
           {view.sections.map((sec) => (
             <SectionCard key={sec.category} title={sec.categoryLabel} items={sec.items} />
           ))}
        </div>
      )}
    </div>
  );
}

function InfoPill({ label, value, colored = false }: { label: string; value: string; colored?: boolean }) {
  return (
    <div className={`rounded-3xl border border-white px-4 py-3 flex flex-col items-center justify-center text-center shadow-sm ${colored ? "bg-rose-50/80" : "bg-stone-50/80"}`}>
      <p className={`text-[10px] uppercase font-bold tracking-widest mb-1 ${colored ? "text-rose-400" : "text-stone-400"}`}>{label}</p>
      <p className={`text-base font-semibold ${colored ? "text-rose-900" : "text-stone-800"}`}>{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  items,
}: {
  title: string;
  items: { id: string; title: string; bodyLines: string[] }[];
}) {
  return (
    <div className="glass-card-light rounded-[2rem] p-6 md:p-8 bg-white/70">
      <h3 className="text-lg font-serif text-stone-800 mb-6">{title}</h3>
      <div className="space-y-6">
        {items.map((item) => (
          <div key={item.id} className="relative pl-6 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-1 before:bg-indigo-100 before:rounded-full pb-2 last:pb-0">
            <p className="text-base font-semibold text-stone-800 mb-3">{item.title}</p>
            <div className="space-y-2.5">
               {item.bodyLines.map((line, i) => (
                 <p key={`${item.id}-${i}`} className="flex items-start gap-3 text-[15px] text-stone-600 leading-relaxed font-light">
                   <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 mt-2 shrink-0"></span>
                   <span>{line}</span>
                 </p>
               ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
