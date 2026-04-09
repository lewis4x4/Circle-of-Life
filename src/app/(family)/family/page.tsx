"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { 
  Banknote, 
  CalendarClock, 
  ClipboardList, 
  FileText, 
  HeartPulse, 
  Loader2, 
  Shield,
  Activity,
  Heart,
  ChevronRight
} from "lucide-react";

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
      <div className="flex flex-col items-center justify-center py-24 text-stone-500 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
        <p className="text-sm font-medium tracking-wide">Bringing up your family dashboard…</p>
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
          className="w-full h-12 rounded-full bg-white text-stone-700 font-medium border border-stone-200 shadow-sm hover:bg-stone-50 transition-colors"
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

  return (
    <div className="pb-24 md:pb-8 flex flex-col gap-10">
      
      {/* ─── PERSONALIZED HEADER ─── */}
      <div className="text-center">
        <div className="w-20 h-20 md:w-24 md:h-24 mx-auto bg-gradient-to-br from-orange-100 to-rose-100 rounded-full flex items-center justify-center border-4 border-white shadow-xl shadow-orange-900/5 mb-4">
          <Heart className="w-8 h-8 md:w-10 md:h-10 text-orange-400/80" />
        </div>
        
        {snapshot.linkedResidents > 0 ? (
          <>
            <h1 className="text-3xl md:text-5xl font-serif text-stone-800 tracking-tight mb-2">
              Care updates for <span className="text-stone-900 font-medium">{snapshot.residentSummary}</span>
            </h1>
            <p className="text-stone-500 max-w-lg mx-auto text-sm md:text-base">
              The latest clinical and billing information directly from your care team at Haven.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl md:text-4xl font-serif text-stone-800 tracking-tight mb-2">
              Welcome to Haven
            </h1>
            <p className="text-stone-500 max-w-lg mx-auto text-sm md:text-base">
              When your account is linked to a resident, updates you are allowed to see will appear here. Ask your facility for an invitation.
            </p>
          </>
        )}
      </div>

      {/* ─── QUICK GLANCE STATS ─── */}
      {snapshot.linkedResidents > 0 && (
        <div className="flex flex-wrap justify-center gap-3 md:gap-4 max-w-2xl mx-auto w-full">
          <StatChip label="Linked residents" value={snapshot.stats.linkedResidents} icon={<Heart className="w-3 h-3 text-emerald-500" />} />
          <StatChip label="Clinical (7 days)" value={snapshot.stats.clinicalWeek} icon={<Activity className="w-3 h-3 text-rose-400" />} />
          <StatChip label="Open billing" value={snapshot.stats.billingOpen} icon={<Banknote className="w-3 h-3 text-amber-500" />} />
          <StatChip label="Feed today" value={snapshot.stats.feedToday} icon={<ClipboardList className="w-3 h-3 text-blue-500" />} />
        </div>
      )}

      {/* ─── THE TIMELINE FEED ─── */}
      <div className="w-full max-w-2xl mx-auto mt-4">
        <h2 className="text-xl font-serif text-stone-800 mb-6 flex items-center gap-2">
          Today&apos;s timeline
        </h2>

        {snapshot.linkedResidents === 0 || snapshot.items.length === 0 ? (
          <div className="glass-card-light rounded-2xl flex flex-col items-center justify-center p-10 text-center border-dashed border-2 border-stone-200/50">
            <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mb-4">
              <CalendarClock className="w-5 h-5 text-stone-400" />
            </div>
            <p className="text-stone-600 font-medium">All caught up!</p>
            <p className="text-sm text-stone-500 mt-1">No recent incidents or invoices. Check back as your team posts updates.</p>
          </div>
        ) : (
          <div className="relative pl-6 md:pl-8 border-l-[3px] border-stone-200/60 pb-8 space-y-6">
            {snapshot.items.map((item) => (
              <TimelineItem key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* ─── PORTAL NAVIGATION CARDS ─── */}
      <div className="w-full max-w-2xl mx-auto">
        <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-400 mb-4 pl-1">
          Explore Portal
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <Link
            href="/family/care-plan"
            className="flex flex-col items-start gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-5 border border-white shadow-sm hover:shadow-md hover:bg-white text-stone-800 transition-all tap-responsive group"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center group-hover:scale-110 transition-transform">
              <HeartPulse className="h-5 w-5 text-rose-500" />
            </div>
            <span className="font-medium text-sm">Care summary</span>
          </Link>
          <Link
            href="/family/billing"
            className="flex flex-col items-start gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-5 border border-white shadow-sm hover:shadow-md hover:bg-white text-stone-800 transition-all tap-responsive group"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Banknote className="h-5 w-5 text-orange-500" />
            </div>
            <span className="font-medium text-sm">Billing summary</span>
          </Link>
          <Link
            href="/family/calendar"
            className="flex flex-col items-start gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-5 border border-white shadow-sm hover:shadow-md hover:bg-white text-stone-800 transition-all tap-responsive group"
          >
            <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center group-hover:scale-110 transition-transform">
              <CalendarClock className="h-5 w-5 text-sky-500" />
            </div>
            <span className="font-medium text-sm">Facility calendar</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── HELPER COMPONENTS ─── */

function TimelineItem({ item }: { item: FamilyFeedItem }) {
  const isInvoice = item.kind === "invoice";
  const isClinical = item.badge === "Clinical";

  const colorConfig = isInvoice
    ? { dot: "bg-amber-400 ring-amber-100", icon: "text-amber-600 bg-amber-50" }
    : isClinical
    ? { dot: "bg-rose-400 ring-rose-100", icon: "text-rose-600 bg-rose-50" }
    : { dot: "bg-stone-400 ring-stone-100", icon: "text-stone-600 bg-stone-100" };

  const icon = isInvoice ? (
    <FileText className="h-4 w-4" />
  ) : isClinical ? (
    <ClipboardList className="h-4 w-4" />
  ) : (
    <Shield className="h-4 w-4" />
  );

  const inner = (
    <div className="glass-card-light rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
      {/* Subtle background glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/40 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      
      <div className="flex items-start justify-between gap-4 mb-3 relative z-10">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${colorConfig.icon}`}>
            {icon}
          </div>
          <div>
            <h3 className="font-medium text-stone-800 leading-tight">{item.title}</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              {item.timeLabel} · {item.residentName}
            </p>
          </div>
        </div>
        {!isInvoice && (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-stone-100 text-stone-500 whitespace-nowrap">
            {item.badge}
          </span>
        )}
      </div>
      <p className="text-sm text-stone-600 leading-relaxed relative z-10">
        {item.detail}
      </p>

      {isInvoice && (
        <div className="mt-4 pt-3 border-t border-stone-100 flex justify-between items-center relative z-10">
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">View Invoice Details</span>
          <ChevronRight className="w-4 h-4 text-stone-400 group-hover:text-amber-500 transition-colors" />
        </div>
      )}
    </div>
  );

  return (
    <div className="relative group">
      {/* Timeline Node */}
      <div className={`absolute -left-[31.5px] md:-left-[39.5px] top-6 w-3 h-3 rounded-full ring-4 ${colorConfig.dot} shadow-sm z-10`} />
      
      {isInvoice ? (
        <Link href={item.href} className="block tap-responsive outline-none focus-visible:ring-2 focus-visible:ring-stone-400 rounded-2xl">
          {inner}
        </Link>
      ) : (
        <div>{inner}</div>
      )}
    </div>
  );
}

function StatChip({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-full glass-card-light py-1.5 px-3 md:px-4 shadow-sm border-white">
      {icon}
      <span className="text-xs font-medium text-stone-600">{label}:</span>
      <span className="text-sm font-bold text-stone-900">{value}</span>
    </div>
  );
}
