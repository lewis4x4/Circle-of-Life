"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Loader2, MapPin } from "lucide-react";

import { fetchFamilyCalendarEvents, type FamilyCalendarEventRow } from "@/lib/family/family-calendar-data";
import {
  FAMILY_CALENDAR_EMPTY_DESCRIPTION,
  FAMILY_CALENDAR_EMPTY_TITLE,
  FAMILY_CALENDAR_LOADING,
  FAMILY_CALENDAR_PAGE_DESCRIPTION,
  FAMILY_CALENDAR_PAGE_TITLE,
  FAMILY_CALENDAR_RETRY,
} from "@/lib/family/family-portal-copy";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";
import { cn } from "@/lib/utils";

export default function FamilyCalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FamilyCalendarEventRow[]>([]);
  const [residentSummary, setResidentSummary] = useState("");

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
      const [calendarResult, residentResult] = await Promise.all([
        fetchFamilyCalendarEvents(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!calendarResult.ok) {
        setLoadError(calendarResult.error);
        setRows([]);
      } else {
        setRows(calendarResult.rows);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
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
      <div className="mx-auto mt-20 max-w-lg rounded-lg border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 py-48 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium tracking-wide">{FAMILY_CALENDAR_LOADING}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto mt-20 max-w-md space-y-4 pb-16 text-center md:pb-0">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-foreground">
          <CalendarDays className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className={cn(
            "h-12 w-full rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          )}
          onClick={() => void load()}
        >
          {FAMILY_CALENDAR_RETRY}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-8 pt-12 md:pt-20">
      <FamilySectionIntro
        active="calendar"
        title={FAMILY_CALENDAR_PAGE_TITLE}
        description={FAMILY_CALENDAR_PAGE_DESCRIPTION}
        residentSummary={residentSummary || undefined}
      />

      <div className="w-full space-y-6">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{FAMILY_CALENDAR_EMPTY_TITLE}</p>
            <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
              {FAMILY_CALENDAR_EMPTY_DESCRIPTION}
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
    <div
      className={cn(
        "relative rounded-lg border border-border p-6 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
        isCancelled ? "bg-muted/60 opacity-60" : "bg-card hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-5">
        {/* Date Callout Box — warm split-theme uses bg-muted (softer than admin's bg-card) */}
        <div className="flex h-[4.5rem] w-16 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-muted">
          <span className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {ev.dayLabel.split(",")[0].substring(0, 3)}
          </span>
          <span className="font-serif text-xl tabular-nums text-foreground">{ev.dayLabel.split(" ")[2] || "0"}</span>
        </div>

        <div className="flex-1 pt-1">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3
              className={cn(
                "font-serif text-lg",
                isCancelled ? "text-muted-foreground line-through" : "text-foreground",
              )}
            >
              {ev.title}
            </h3>
            {ev.tag && (
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                  isCancelled
                    ? "border-destructive/30 bg-destructive/10 text-foreground"
                    : "border-info/30 bg-info/10 text-foreground",
                )}
              >
                {isCancelled ? "Cancelled" : ev.tag}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {ev.timeLabel}
            </p>
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {ev.locationLine}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
