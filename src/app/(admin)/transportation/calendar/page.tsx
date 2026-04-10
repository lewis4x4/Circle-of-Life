"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
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
import { ArrowLeft, Bus, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, MapPin } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { triggerFileDownload } from "@/lib/csv-export";
import { buildTransportRequestsIcs } from "@/lib/transportation/transport-requests-ics";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionItem, MotionList } from "@/components/ui/motion-list";

/** US-style week strip (Sunday start) — aligns with operator expectations in Florida. */
const WEEK_STARTS_ON = 0 as const;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type CalendarViewMode = "week" | "month";

type TransportRequestRow = Database["public"]["Tables"]["resident_transport_requests"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

function formatEnum(s: string) {
  return s.replace(/_/g, " ");
}

function formatAppointmentTime(t: string | null): string {
  if (!t) return "—";
  try {
    return format(parseISO(`2000-01-01T${t.slice(0, 8)}`), "h:mm a");
  } catch {
    return t;
  }
}

export default function TransportationWeekCalendarPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [weekAnchor, setWeekAnchor] = useState(() => startOfDay(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(startOfDay(new Date())));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [rows, setRows] = useState<TransportRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekStart = useMemo(
    () => startOfWeek(weekAnchor, { weekStartsOn: WEEK_STARTS_ON }),
    [weekAnchor],
  );
  const weekEnd = useMemo(
    () => endOfWeek(weekAnchor, { weekStartsOn: WEEK_STARTS_ON }),
    [weekAnchor],
  );

  const monthStart = useMemo(() => startOfMonth(monthAnchor), [monthAnchor]);
  const monthEnd = useMemo(() => endOfMonth(monthAnchor), [monthAnchor]);
  const monthCalendarStart = useMemo(
    () => startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON }),
    [monthStart],
  );
  const monthCalendarEnd = useMemo(
    () => endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON }),
    [monthEnd],
  );

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekStart, weekEnd],
  );

  const monthGridDays = useMemo(
    () => eachDayOfInterval({ start: monthCalendarStart, end: monthCalendarEnd }),
    [monthCalendarStart, monthCalendarEnd],
  );

  const rangeStart = viewMode === "week" ? weekStart : monthCalendarStart;
  const rangeEnd = viewMode === "week" ? weekEnd : monthCalendarEnd;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    const from = format(rangeStart, "yyyy-MM-dd");
    const to = format(rangeEnd, "yyyy-MM-dd");
    try {
      const { data, error: qErr } = await supabase
        .from("resident_transport_requests")
        .select("id, appointment_date, appointment_time, destination_name, purpose, status, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .gte("appointment_date", from)
        .lte("appointment_date", to)
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true })
        .limit(viewMode === "month" ? 500 : 150);
      if (qErr) throw qErr;
      setRows((data ?? []) as TransportRequestRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transport requests.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId, rangeStart, rangeEnd, viewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Keep agenda day inside the visible month grid when the anchor month changes. */
  useEffect(() => {
    if (viewMode !== "month") return;
    setSelectedDay((sd) => {
      const t = sd.getTime();
      if (t >= monthCalendarStart.getTime() && t <= monthCalendarEnd.getTime()) return sd;
      return monthStart;
    });
  }, [viewMode, monthAnchor, monthCalendarStart, monthCalendarEnd, monthStart]);

  const countsByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const d = r.appointment_date;
      if (!d) continue;
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const agendaForSelected = useMemo(() => {
    const key = format(selectedDay, "yyyy-MM-dd");
    return rows.filter((r) => r.appointment_date === key);
  }, [rows, selectedDay]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const goPrevWeek = () => {
    setWeekAnchor((d) => addWeeks(d, -1));
    setSelectedDay((d) => addWeeks(d, -1));
  };
  const goNextWeek = () => {
    setWeekAnchor((d) => addWeeks(d, 1));
    setSelectedDay((d) => addWeeks(d, 1));
  };
  const goThisWeek = () => {
    const t = startOfDay(new Date());
    setWeekAnchor(t);
    setSelectedDay(t);
  };

  const goPrevMonth = () => setMonthAnchor((d) => addMonths(d, -1));
  const goNextMonth = () => setMonthAnchor((d) => addMonths(d, 1));
  const goThisMonth = () => {
    const t = startOfDay(new Date());
    setMonthAnchor(startOfMonth(t));
    setSelectedDay(t);
  };

  const selectDay = (day: Date) => {
    setSelectedDay(day);
    if (viewMode === "month" && !isSameMonth(day, monthStart)) {
      setMonthAnchor(startOfMonth(day));
    }
  };

  const setCalendarView = (mode: CalendarViewMode) => {
    setViewMode(mode);
    if (mode === "month") {
      setMonthAnchor(startOfMonth(selectedDay));
    } else {
      setWeekAnchor(selectedDay);
    }
  };

  const downloadCalendarIcs = () => {
    const text = buildTransportRequestsIcs(
      rows.map((r) => ({
        id: r.id,
        appointment_date: r.appointment_date,
        appointment_time: r.appointment_time,
        destination_name: r.destination_name,
        purpose: r.purpose,
        status: r.status,
        destination_address: r.destination_address,
        residents: r.residents,
      })),
      "Haven transport (calendar)",
    );
    const from = format(rangeStart, "yyyy-MM-dd");
    const to = format(rangeEnd, "yyyy-MM-dd");
    triggerFileDownload(`haven-transport-${viewMode}-${from}_${to}.ics`, text, "text/calendar;charset=utf-8");
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-indigo-700/10" secondaryClass="bg-slate-900/10" />

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
              SYS: Module 15 — {viewMode === "week" ? "Week" : "Month"} view
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
              <CalendarDays className="h-8 w-8 text-indigo-600 dark:text-indigo-400 shrink-0" />
              Transport calendar
            </h1>
            <p className="mt-1 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-sm">
              {viewMode === "week"
                ? "Seven-day strip with trip counts; agenda for the selected day. Same data as the hub, scoped to this calendar week."
                : "Full-month grid (Sunday-start) with trip counts; padding days outside the month are muted. Agenda uses the selected day."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-slate-200 bg-slate-50/80 p-0.5 dark:border-white/10 dark:bg-white/[0.04]">
              <button
                type="button"
                onClick={() => setCalendarView("week")}
                className={cn(
                  "h-10 rounded-full px-4 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  viewMode === "week"
                    ? "bg-white text-indigo-700 shadow-sm dark:bg-white/10 dark:text-indigo-300"
                    : "text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200",
                )}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setCalendarView("month")}
                className={cn(
                  "h-10 rounded-full px-4 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  viewMode === "month"
                    ? "bg-white text-indigo-700 shadow-sm dark:bg-white/10 dark:text-indigo-300"
                    : "text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200",
                )}
              >
                Month
              </button>
            </div>
            <button
              type="button"
              onClick={viewMode === "week" ? goThisWeek : goThisMonth}
              className={cn(
                buttonVariants({ variant: "outline", size: "default" }),
                "h-11 rounded-full text-[10px] font-bold uppercase tracking-widest",
              )}
            >
              {viewMode === "week" ? "This week" : "This month"}
            </button>
            <Link
              href="/admin/transportation"
              className={cn(
                buttonVariants({ variant: "outline", size: "default" }),
                "h-11 rounded-full gap-2 text-[10px] font-bold uppercase tracking-widest",
              )}
            >
              <ArrowLeft className="h-4 w-4" />
              Hub
            </Link>
          </div>
        </div>

        {!facilityReady && (
          <p className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            Select a facility to load the calendar.
          </p>
        )}

        {error && (
          <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </p>
        )}

        {facilityReady && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 px-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={viewMode === "week" ? goPrevWeek : goPrevMonth}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "icon" }),
                    "h-10 w-10 rounded-full shrink-0",
                  )}
                  aria-label={viewMode === "week" ? "Previous week" : "Previous month"}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[12rem] text-center md:min-w-[16rem]">
                  {viewMode === "week"
                    ? `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`
                    : format(monthStart, "MMMM yyyy")}
                </p>
                <button
                  type="button"
                  onClick={viewMode === "week" ? goNextWeek : goNextMonth}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "icon" }),
                    "h-10 w-10 rounded-full shrink-0",
                  )}
                  aria-label={viewMode === "week" ? "Next week" : "Next month"}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadCalendarIcs}
                  disabled={loading}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "default" }),
                    "h-11 rounded-full gap-2 text-[10px] font-bold uppercase tracking-widest",
                    loading && "pointer-events-none opacity-50",
                  )}
                  aria-label="Download calendar as ICS file"
                >
                  <Download className="h-4 w-4" />
                  .ics
                </button>
                <Link
                  href="/admin/transportation/requests/new"
                  className={cn(buttonVariants({ size: "default" }), "h-11 rounded-full text-[10px] font-bold uppercase tracking-widest bg-indigo-600 hover:bg-indigo-700 text-white")}
                >
                  + Request
                </Link>
              </div>
            </div>

            {viewMode === "week" ? (
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {weekDays.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const n = countsByDate.get(key) ?? 0;
                  const selected = isSameDay(day, selectedDay);
                  const today = isSameDay(day, new Date());
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={cn(
                        "rounded-2xl border p-2 sm:p-3 text-center transition-colors tap-responsive min-h-[4.5rem] sm:min-h-[5.5rem] flex flex-col items-center justify-center gap-0.5",
                        selected
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15 dark:border-indigo-400/50 shadow-sm"
                          : "border-slate-200/80 bg-white/60 dark:bg-white/[0.03] dark:border-white/10 hover:border-indigo-300 dark:hover:border-indigo-500/30",
                        today && !selected && "ring-1 ring-slate-300 dark:ring-white/20",
                      )}
                    >
                      <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {format(day, "EEE")}
                      </span>
                      <span className="text-lg sm:text-xl font-display font-semibold text-slate-900 dark:text-white">
                        {format(day, "d")}
                      </span>
                      <span
                        className={cn(
                          "text-[9px] sm:text-[10px] font-bold tabular-nums",
                          n > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400",
                        )}
                      >
                        {n} trip{n === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-1 px-0.5">
                  {WEEKDAY_LABELS.map((label) => (
                    <div
                      key={label}
                      className="py-1 text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
                    >
                      {label}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {monthGridDays.map((day) => {
                    const key = format(day, "yyyy-MM-dd");
                    const n = countsByDate.get(key) ?? 0;
                    const selected = isSameDay(day, selectedDay);
                    const today = isSameDay(day, new Date());
                    const inMonth = isSameMonth(day, monthStart);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => selectDay(day)}
                        className={cn(
                          "rounded-2xl border p-1.5 sm:p-2.5 text-center transition-colors tap-responsive min-h-[3.75rem] sm:min-h-[4.5rem] flex flex-col items-center justify-center gap-0.5",
                          !inMonth && "opacity-45",
                          selected
                            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15 dark:border-indigo-400/50 shadow-sm"
                            : "border-slate-200/80 bg-white/60 dark:bg-white/[0.03] dark:border-white/10 hover:border-indigo-300 dark:hover:border-indigo-500/30",
                          today && !selected && "ring-1 ring-slate-300 dark:ring-white/20",
                        )}
                      >
                        <span className="text-base sm:text-lg font-display font-semibold text-slate-900 dark:text-white">
                          {format(day, "d")}
                        </span>
                        <span
                          className={cn(
                            "text-[8px] sm:text-[9px] font-bold tabular-nums leading-tight",
                            n > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400",
                          )}
                        >
                          {n > 0 ? `${n} trip${n === 1 ? "" : "s"}` : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="glass-panel rounded-[2rem] border border-slate-200/60 bg-white/60 p-6 md:p-8 dark:border-white/5 dark:bg-white/[0.015]">
              <h2 className="text-[12px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-6 px-1">
                {format(selectedDay, "EEEE, MMMM d")}
              </h2>
              {loading ? (
                <p className="text-sm font-mono text-slate-500 pl-2">Loading…</p>
              ) : agendaForSelected.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-400 pl-2">No trips on this day.</p>
              ) : (
                <MotionList className="space-y-3">
                  {agendaForSelected.map((row) => {
                    const name = row.residents
                      ? `${row.residents.first_name} ${row.residents.last_name}`
                      : "Resident";
                    return (
                      <MotionItem key={row.id}>
                        <Link
                          href={`/admin/transportation/requests/${row.id}`}
                          className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200/90 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300 dark:border-white/5 dark:bg-white/[0.03] dark:hover:border-indigo-500/40 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5">
                              <Bus className="h-5 w-5 text-indigo-500" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                {name}
                              </p>
                              <p className="mt-1 flex items-center gap-2 truncate text-sm font-medium text-slate-600 dark:text-slate-400">
                                <MapPin className="h-3.5 w-3.5 shrink-0 opacity-50" />
                                {row.destination_name}
                                {row.purpose ? (
                                  <>
                                    <span className="opacity-30">•</span>
                                    {row.purpose}
                                  </>
                                ) : null}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400">
                              <Clock className="h-3 w-3" />
                              {formatAppointmentTime(row.appointment_time)}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
                                row.status === "scheduled"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
                                  : row.status === "completed"
                                    ? "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
                              )}
                            >
                              {formatEnum(row.status)}
                            </span>
                          </div>
                        </Link>
                      </MotionItem>
                    );
                  })}
                </MotionList>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
