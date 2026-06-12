"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Download } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { triggerFileDownload } from "@/lib/csv-export";
import {
  buildMasterCalendarIcs,
  fetchMasterCalendarEvents,
  MASTER_CALENDAR_LAYERS,
  type MasterCalendarEvent,
  type MasterCalendarLayer,
} from "@/lib/office/master-calendar";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/** US-style week strip (Sunday start) — aligns with operator expectations in Florida. */
const WEEK_STARTS_ON = 0 as const;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const LAYER_TONE: Record<MasterCalendarLayer, "info" | "warning" | "danger" | "muted"> = {
  transport: "info",
  meetings: "muted",
  inservices: "info",
  drills: "warning",
  expirations: "danger",
  surveys: "warning",
};

function formatEventTime(time: string | null): string {
  if (!time) return "All day";
  try {
    return format(parseISO(`2000-01-01T${time.slice(0, 8)}`), "h:mm a");
  } catch {
    return time;
  }
}

export default function AdminMasterCalendarPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(startOfDay(new Date())));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<MasterCalendarEvent[]>([]);
  const [enabledLayers, setEnabledLayers] = useState<Set<MasterCalendarLayer>>(
    () => new Set(MASTER_CALENDAR_LAYERS.map((l) => l.id)),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const gridStart = useMemo(
    () => startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: WEEK_STARTS_ON }),
    [monthAnchor],
  );
  const gridEnd = useMemo(
    () => endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: WEEK_STARTS_ON }),
    [monthAnchor],
  );
  const gridDays = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  const load = useCallback(async () => {
    if (!facilityReady) {
      setEvents([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await fetchMasterCalendarEvents(
        supabase,
        selectedFacilityId as string,
        format(gridStart, "yyyy-MM-dd"),
        format(gridEnd, "yyyy-MM-dd"),
      );
      setEvents(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load calendar events.");
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady, gridStart, gridEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleEvents = useMemo(
    () => events.filter((ev) => enabledLayers.has(ev.layer)),
    [events, enabledLayers],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, MasterCalendarEvent[]>();
    for (const ev of visibleEvents) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [visibleEvents]);

  const selectedDayIso = format(selectedDay, "yyyy-MM-dd");
  const selectedDayEvents = eventsByDay.get(selectedDayIso) ?? [];

  const toggleLayer = useCallback((layer: MasterCalendarLayer) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  const exportIcs = useCallback(() => {
    const ics = buildMasterCalendarIcs(visibleEvents);
    triggerFileDownload(
      `facility-calendar-${format(monthAnchor, "yyyy-MM")}.ics`,
      ics,
      "text/calendar",
    );
  }, [visibleEvents, monthAnchor]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <CalendarDays className="h-8 w-8 text-info shrink-0" aria-hidden />
              Facility master calendar
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              One calendar layering transportation, meetings, in-services, drills and emergency
              checks, document expirations (license/insurance vault), and survey history.
              Per-facility, RLS-scoped, exportable as .ics.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 font-medium text-[10px] uppercase tracking-wider"
            disabled={visibleEvents.length === 0}
            onClick={exportIcs}
          >
            <Download className="h-4 w-4" aria-hidden />
            Download .ics (loaded window)
          </Button>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — the master calendar is per-facility.
          </p>
        ) : null}

        {facilityReady ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Previous month"
                  onClick={() => setMonthAnchor((d) => addMonths(d, -1))}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <span className="text-lg font-semibold text-foreground tabular-nums min-w-[160px] text-center">
                  {format(monthAnchor, "MMMM yyyy")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Next month"
                  onClick={() => setMonthAnchor((d) => addMonths(d, 1))}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="font-medium text-[10px] uppercase tracking-wider"
                  onClick={() => {
                    const today = startOfDay(new Date());
                    setMonthAnchor(startOfMonth(today));
                    setSelectedDay(today);
                  }}
                >
                  Today
                </Button>
              </div>
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="sr-only">Calendar layers</legend>
                {MASTER_CALENDAR_LAYERS.map((layer) => {
                  const active = enabledLayers.has(layer.id);
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleLayer(layer.id)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted",
                      )}
                    >
                      {layer.label}
                    </button>
                  );
                })}
              </fieldset>
            </div>

            {isLoading ? <AdminTableLoadingState /> : null}
            {!isLoading && loadError ? (
              <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
            ) : null}

            {!isLoading && !loadError ? (
              <>
                <div className="rounded-[var(--radius)] border border-border bg-card overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-border bg-card/60">
                    {WEEKDAY_LABELS.map((label) => (
                      <div
                        key={label}
                        className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {gridDays.map((day) => {
                      const dayIso = format(day, "yyyy-MM-dd");
                      const dayEvents = eventsByDay.get(dayIso) ?? [];
                      const inMonth = isSameMonth(day, monthAnchor);
                      const isSelected = isSameDay(day, selectedDay);
                      const isToday = isSameDay(day, new Date());
                      return (
                        <button
                          key={dayIso}
                          type="button"
                          onClick={() => setSelectedDay(startOfDay(day))}
                          aria-label={`${format(day, "MMMM d, yyyy")}: ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                          className={cn(
                            "min-h-[84px] border-b border-r border-border p-1.5 text-left align-top transition-colors",
                            !inMonth && "bg-muted/30 text-muted-foreground",
                            isSelected && "bg-primary/10",
                            "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                              isToday
                                ? "bg-primary text-primary-foreground"
                                : inMonth
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {format(day, "d")}
                          </span>
                          <div className="mt-1 space-y-0.5">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <div
                                key={ev.id}
                                className="truncate rounded-sm bg-muted px-1 py-0.5 text-[10px] leading-tight text-foreground"
                              >
                                {ev.title}
                              </div>
                            ))}
                            {dayEvents.length > 3 ? (
                              <div className="text-[10px] text-muted-foreground tabular-nums">
                                +{dayEvents.length - 3} more
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <section aria-labelledby="calendar-day-heading" className="space-y-3">
                  <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                    <h3 id="calendar-day-heading" className="text-lg font-semibold text-foreground">
                      {format(selectedDay, "EEEE, MMMM d, yyyy")}
                      <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                        {selectedDayEvents.length} event{selectedDayEvents.length === 1 ? "" : "s"}
                      </span>
                    </h3>
                  </div>
                  {selectedDayEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground pl-2">
                      Nothing scheduled on this day for the enabled layers.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedDayEvents.map((ev) => {
                        const layerLabel =
                          MASTER_CALENDAR_LAYERS.find((l) => l.id === ev.layer)?.label ?? ev.layer;
                        const body = (
                          <>
                            <div className="flex flex-col gap-1 min-w-0 flex-1">
                              <span className="font-semibold text-foreground truncate">{ev.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatEventTime(ev.time)}
                                {ev.detail ? ` · ${ev.detail}` : ""}
                              </span>
                            </div>
                            <StatusPill tone={LAYER_TONE[ev.layer]}>{layerLabel}</StatusPill>
                          </>
                        );
                        const rowClass =
                          "flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between w-full";
                        return (
                          <li key={ev.id}>
                            {ev.href ? (
                              <Link
                                href={ev.href}
                                className={cn(
                                  rowClass,
                                  "hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                                )}
                              >
                                {body}
                              </Link>
                            ) : (
                              <div className={rowClass}>{body}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
