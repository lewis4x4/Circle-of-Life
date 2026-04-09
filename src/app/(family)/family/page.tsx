"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Banknote, FileText, Loader2, Shield, Heart, ChevronRight } from "lucide-react";

import {
  fetchFamilyHomeSnapshot,
  type FamilyFeedItem,
  type FamilyHomeSnapshot,
} from "@/lib/family/family-feed";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

export default function FamilyHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FamilyHomeSnapshot | null>(null);

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
      const result = await fetchFamilyHomeSnapshot(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setSnapshot(null);
      } else {
        setLoadError(null);
        setSnapshot(result.data);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load feed.");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white/60 backdrop-blur-md px-6 py-4 text-sm text-rose-800 shadow-sm max-w-lg mx-auto">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-stone-500 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-rose-400" />
        <p className="text-sm font-medium tracking-wide">Opening journal…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 pb-16 md:pb-0 max-w-md mx-auto text-center mt-12">
        <div className="rounded-xl border border-rose-200 bg-white/70 backdrop-blur-xl px-4 py-6 text-sm text-rose-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Shield className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className="w-full h-12 rounded-full bg-white text-stone-700 font-medium border border-stone-200 shadow-sm hover:bg-stone-50 transition-colors cursor-pointer"
          onClick={() => void load()}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (!snapshot) {
    return null;
  }

  const initial = snapshot.residentSummary ? snapshot.residentSummary.charAt(0).toUpperCase() : "H";
  const firstName = snapshot.residentSummary ? snapshot.residentSummary.split(" ")[0] : "Resident";

  return (
    <div className="pb-8 flex flex-col items-center">
      
      {/* ─── FULL BLEED COVER PHOTO ─── */}
      <div className="absolute inset-x-0 top-0 z-0 h-48 w-full overflow-hidden md:h-64">
        <div className="relative h-full w-full">
          <Image
            src="/family-cover.png"
            alt="Warm watercolor dawn light"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-90 mix-blend-multiply"
          />
        </div>
         {/* Fade to background color seamlessly */}
         <div className="absolute inset-0 bg-gradient-to-t from-[#fffafa] via-transparent to-white/10"></div>
      </div>

      <div className="w-full max-w-2xl px-4 relative z-10 mt-20 md:mt-32">
         {/* ─── OVERLAPPING AVATAR ─── */}
         <div className="text-center mb-10">
           <div className="w-24 h-24 md:w-32 md:h-32 mx-auto bg-white rounded-full flex items-center justify-center p-2 shadow-[0_20px_40px_rgba(251,146,60,0.15)] mb-6 ring-1 ring-stone-900/5">
              <div className="w-full h-full rounded-full bg-gradient-to-br from-stone-50 to-stone-200 border-2 border-stone-100 flex items-center justify-center">
                 <span className="text-4xl md:text-5xl font-serif text-stone-600 font-light">{initial}</span>
              </div>
           </div>
           
           {snapshot.linkedResidents > 0 ? (
             <>
               <h1 className="text-4xl md:text-6xl font-serif text-stone-800 tracking-tight mb-2">
                 <span className="font-medium text-stone-900">{snapshot.residentSummary}</span>
               </h1>
               <p className="text-stone-500/80 max-w-lg mx-auto text-base md:text-lg mb-8 font-serif italic">
                 Care Journal
               </p>
             </>
           ) : (
             <>
               <h1 className="text-4xl md:text-5xl font-serif text-stone-800 tracking-tight mb-2">
                 Welcome
               </h1>
               <p className="text-stone-500 max-w-lg mx-auto text-sm md:text-base">
                 Ask your facility for an invitation link to connect your loved one.
               </p>
             </>
           )}

            {/* ─── QUICK GLANCE STATS ─── */}
           {snapshot.linkedResidents > 0 && (
             <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto w-full">
               <StatChip label="Connected" value={snapshot.stats.linkedResidents} />
               <StatChip label="Recent Clinical" value={snapshot.stats.clinicalWeek} />
               {Number(snapshot.stats.billingOpen) > 0 && (
                  <StatChip label="Open Invoices" value={snapshot.stats.billingOpen} />
               )}
             </div>
           )}
         </div>

         {/* ─── THE JOURNAL FEED ─── */}
         <div className="w-full mt-10 md:mt-16">
           <div className="flex items-center justify-center mb-10">
             <div className="h-px bg-stone-200 flex-1"></div>
             <h2 className="text-2xl md:text-3xl font-serif text-stone-800 tracking-tight px-6 text-center">
               {firstName}&apos;s Updates
             </h2>
             <div className="h-px bg-stone-200 flex-1"></div>
           </div>

           {snapshot.linkedResidents === 0 || snapshot.items.length === 0 ? (
             <div className="flex flex-col items-center justify-center p-12 text-center">
               <p className="text-stone-400 font-serif italic text-xl">The journal is quiet right now.</p>
               <p className="text-sm text-stone-400 mt-2">Updates will flow in gently when your team posts them.</p>
             </div>
           ) : (
             <div className="space-y-6 md:space-y-8">
               {snapshot.items.map((item) => (
                 <JournalEntryCard key={`${item.kind}-${item.id}`} item={item} />
               ))}
             </div>
           )}
         </div>
      </div>
    </div>
  );
}

/* ─── HELPER COMPONENTS ─── */

function JournalEntryCard({ item }: { item: FamilyFeedItem }) {
  const isInvoice = item.kind === "invoice";
  const isClinical = item.badge === "Clinical";

  const colorConfig = isInvoice
    ? { iconBg: "bg-amber-100", iconColor: "text-amber-700" }
    : isClinical
    ? { iconBg: "bg-emerald-100", iconColor: "text-emerald-700" }
    : { iconBg: "bg-sky-100", iconColor: "text-sky-700" };

  const icon = isInvoice ? (
    <Banknote className={`w-5 h-5 ${colorConfig.iconColor}`} />
  ) : isClinical ? (
    <Heart className={`w-5 h-5 ${colorConfig.iconColor}`} />
  ) : (
    <FileText className={`w-5 h-5 ${colorConfig.iconColor}`} />
  );

  const inner = (
    <div className="glass-card-light rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgb(251,146,60,0.08)] transition-all duration-300 relative group bg-white/70">
      
      <div className="flex items-start justify-between gap-4 mb-4">
         <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold mb-1">{item.timeLabel}</span>
            <h3 className="text-xl font-serif text-stone-800 leading-tight">{item.title}</h3>
         </div>
         {/* Subtle Floating Badge */}
         <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-sm ${colorConfig.iconBg}`}>
            {icon}
         </div>
      </div>
      
      <p className="text-base text-stone-600 leading-relaxed font-light">
         {item.detail} 
      </p>

      {isInvoice && (
         <div className="mt-6 pt-4 border-t border-stone-200/60 flex justify-between items-center relative z-10 group/btn tap-responsive">
            <span className="text-xs font-semibold uppercase tracking-widest text-stone-500 group-hover/btn:text-stone-900 transition-colors">Review Documentation</span>
            <div className="w-8 h-8 rounded-full bg-stone-100 group-hover/btn:bg-stone-200 flex items-center justify-center transition-colors">
               <ChevronRight className="w-4 h-4 text-stone-500" />
            </div>
         </div>
      )}
    </div>
  );

  return (
    <div className="relative group w-full">
      {isInvoice ? (
        <Link href={item.href} className="block outline-none focus-visible:ring-2 focus-visible:ring-stone-400 rounded-[2rem]">
          {inner}
        </Link>
      ) : (
        <div>{inner}</div>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl py-1.5 px-4">
      <span className="text-[10px] uppercase font-bold tracking-widest text-stone-400 mb-0.5">{label}</span>
      <span className="text-lg font-serif text-stone-700">{value}</span>
    </div>
  );
}
