"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Loader2, MapPin } from "lucide-react";

import { fetchFamilyCalendarEvents, type FamilyCalendarEventRow } from "@/lib/family/family-calendar-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

export default function FamilyCalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FamilyCalendarEventRow[]>([]);

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
      const result = await fetchFamilyCalendarEvents(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setRows([]);
      } else {
        setRows(result.rows);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load calendar.");
      setRows([]);
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
        <p className="text-sm font-medium tracking-wide">Syncing itinerary…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 pb-16 md:pb-0 max-w-md mx-auto text-center mt-20">
        <div className="rounded-2xl border border-rose-200 bg-white/70 backdrop-blur-xl px-4 py-6 text-sm text-rose-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <CalendarDays className="w-8 h-8 text-rose-400 mx-auto mb-3" />
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

  return (
    <div className="pb-8 flex flex-col items-center max-w-3xl mx-auto w-full px-4 pt-12 md:pt-20">
      
      {/* HEADER */}
      <div className="text-center mb-16">
        <div className="w-16 h-16 mx-auto bg-violet-100 rounded-[1.5rem] flex items-center justify-center rounded-tr-sm -rotate-3 transform mb-6 shadow-sm">
           <CalendarDays className="w-8 h-8 text-violet-500 rotate-3" />
        </div>
        <h1 className="text-4xl md:text-5xl font-serif text-stone-800 tracking-tight mb-3">Facility Calendar</h1>
        <p className="text-stone-500 max-w-lg mx-auto text-base">
          Community activities scheduled at your loved one&apos;s facility (read-only). Telehealth and private visits
          may not appear until those modules are connected.
        </p>
      </div>

      <div className="w-full space-y-6">
        {rows.length === 0 ? (
          <div className="glass-card-light rounded-[2rem] p-10 text-center border-dashed border-2 border-stone-200/50">
            <p className="text-stone-600 font-serif text-xl italic mb-2">No scheduled activities.</p>
            <p className="text-sm text-stone-500 max-w-md mx-auto">
               We could not find any activities in the selected window, or your family link does not include calendar access.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((ev) => (
               <CalendarEventCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarEventCard({ ev }: { ev: FamilyCalendarEventRow }) {
  const isCancelled = ev.cancelled;
  
  return (
    <div className={`glass-card-light rounded-[2rem] p-6 shadow-sm transition-all relative ${isCancelled ? "opacity-60 bg-white/40" : "bg-white/70 hover:shadow-md"}`}>
      <div className="flex items-start gap-5">
         
         {/* Date Callout Box */}
         <div className="w-16 h-[4.5rem] rounded-2xl bg-stone-100 flex flex-col items-center justify-center shrink-0 border border-white shadow-inner">
            <span className="text-[10px] uppercase font-bold text-stone-400 tracking-wider mb-0.5">{ev.dayLabel.split(",")[0].substring(0,3)}</span> {/* e.g. Mon */}
            <span className="text-xl font-serif text-stone-800">{ev.dayLabel.split(" ")[2] || "0"}</span> {/* e.g. 15 */}
         </div>

         <div className="flex-1 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
               <h3 className={`text-lg font-serif ${isCancelled ? "line-through text-stone-500" : "text-stone-800"}`}>
                  {ev.title}
               </h3>
               {ev.tag && (
                  <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold ${isCancelled ? "bg-rose-100 text-rose-600" : "bg-violet-100 text-violet-700"}`}>
                     {isCancelled ? "Cancelled" : ev.tag}
                  </span>
               )}
            </div>

            <div className="space-y-1.5">
               <p className="flex items-center gap-2 text-sm text-stone-500 font-medium">
                  <Clock className="w-4 h-4 text-stone-300" />
                  {ev.timeLabel}
               </p>
               <p className="flex items-center gap-2 text-sm text-stone-500 font-medium">
                  <MapPin className="w-4 h-4 text-stone-300" />
                  {ev.locationLine}
               </p>
            </div>
         </div>
      </div>
    </div>
  )
}
