"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Loader2, MapPin } from "lucide-react";

import { fetchFamilyCalendarEvents, type FamilyCalendarEventRow } from "@/lib/family/family-calendar-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading calendar…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 pb-16 md:pb-0">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{loadError}</div>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }), "border-stone-300")}
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-display">
            <CalendarDays className="h-6 w-6 text-orange-600" />
            Calendar
          </CardTitle>
          <CardDescription>
            Community activities scheduled at your loved one&apos;s facility (read-only). Telehealth and private visits
            may not appear until those modules are connected.
          </CardDescription>
        </CardHeader>
      </Card>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-600">
          No scheduled activities in the selected window, or your family link does not include access to this calendar.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((ev) => (
            <Card key={ev.id} className="border-stone-200 bg-white text-stone-900">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold text-stone-900">{ev.title}</p>
                  <Badge
                    variant="outline"
                    className={
                      ev.cancelled
                        ? "border-rose-300 text-rose-800"
                        : "border-stone-300 text-stone-700"
                    }
                  >
                    {ev.tag}
                  </Badge>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-stone-600">
                  <CalendarDays className="h-4 w-4 text-stone-400" />
                  {ev.dayLabel}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-stone-600">
                  <Clock className="h-4 w-4 text-stone-400" />
                  {ev.timeLabel}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-stone-600">
                  <MapPin className="h-4 w-4 text-stone-400" />
                  {ev.locationLine}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
