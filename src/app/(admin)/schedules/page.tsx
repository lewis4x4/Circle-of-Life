"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays, Download } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type ScheduleRow = {
  id: string;
  weekStartDate: string;
  status: string;
  publishedAt: string | null;
  notes: string | null;
};

type SupabaseScheduleRow = {
  id: string;
  week_start_date: string;
  status: string;
  published_at: string | null;
  notes: string | null;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

type ScheduleCsvRow = Database["public"]["Tables"]["schedules"]["Row"];

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildSchedulesCsv(rows: ScheduleCsvRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "week_start_date",
    "status",
    "notes",
    "published_at",
    "published_by",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.week_start_date),
      csvEscapeCell(row.status),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.published_at ?? ""),
      csvEscapeCell(row.published_by ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
      csvEscapeCell(row.deleted_at ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

function triggerCsvDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DEFAULT_FILTERS = { search: "", status: "all" };

export default function AdminSchedulesPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchSchedulesFromSupabase(selectedFacilityId);
      setRows(live);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportSchedulesCsv = useCallback(async () => {
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("schedules" as never)
        .select("*")
        .is("deleted_at", null)
        .order("week_start_date", { ascending: false })
        .limit(500);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const res = (await q) as unknown as QueryResult<ScheduleCsvRow>;
      if (res.error) throw res.error;
      const list = res.data ?? [];
      const csv = buildSchedulesCsv(list);
      triggerCsvDownload(`schedule-weeks-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export schedule weeks.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        q.length === 0 ||
        row.notes?.toLowerCase().includes(q) ||
        formatWeekLabel(row.weekStartDate).toLowerCase().includes(q);
      const matchesStatus = status === "all" || row.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, status]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No schedules in this scope",
          description:
            "Live data returned no schedule weeks for the selected facility. Use New schedule week or adjust scope.",
        },
        whenFiltersExcludeAll: {
          title: "No schedules match the current filters",
          description:
            "Schedules are created per facility and week. Pick a facility or clear filters to see more rows.",
        },
      }),
    [rows.length],
  );

  const draftCount = rows.filter((r) => r.status === "draft").length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-blue-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 18 / Workforce Schedules</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Schedule Engine {draftCount > 0 && <PulseDot colorClass="bg-indigo-500" />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={draftCount} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5" /> Draft Weeks
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{draftCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-3 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Weekly schedule containers; shift assignments roll up under each published week.</p>
                 <Link href="/admin/schedules/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                   + Initialize Week
                 </Link>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search week label or notes..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
              { value: "archived", label: "Archived" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setStatus(DEFAULT_FILTERS.status);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <div className="relative overflow-visible z-10 w-full mt-4">
          <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Schedule weeks</h3>
              <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">
                Monday-start weeks; publish when ready for floor use.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 font-mono text-[10px] uppercase tracking-widest"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportSchedulesCsv()}
            >
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Download schedule weeks CSV"}
            </Button>
          </div>
          <MotionList className="space-y-3">
            {filteredRows.map((row) => (
              <MotionItem key={row.id}>
                 <Link href={`/admin/schedules/${row.id}`} className="block focus-visible:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl">
                  <div className="p-4 sm:p-5 rounded-2xl glass-panel group transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full flex items-center justify-between">
                     <div className="flex flex-col gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{formatWeekLabel(row.weekStartDate)}</span>
                        
                        <div className="flex items-center gap-4">
                           <div className="flex flex-col gap-1">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Status</span>
                             <div><ScheduleStatusBadge status={row.status} /></div>
                           </div>
                           
                           <div className="flex flex-col gap-1">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Published</span>
                             <span className="text-xs text-slate-600 dark:text-slate-400">{row.publishedAt ? formatDateTime(row.publishedAt) : "—"}</span>
                           </div>

                           {row.notes && (
                           <div className="hidden md:flex flex-col gap-1 ml-4 border-l pl-4 border-slate-300 dark:border-slate-700">
                             <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Notes</span>
                             <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px] lg:max-w-md truncate">{row.notes.trim()}</span>
                           </div>
                           )}
                        </div>
                     </div>
                  </div>
                 </Link>
              </MotionItem>
            ))}
          </MotionList>
        </div>
      ) : null}
      </div>
    </div>
  );
}

async function fetchSchedulesFromSupabase(selectedFacilityId: string | null): Promise<ScheduleRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("schedules" as never)
    .select("id, week_start_date, status, published_at, notes, deleted_at")
    .is("deleted_at", null)
    .order("week_start_date", { ascending: false })
    .limit(120);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SupabaseScheduleRow>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  return list.map((r) => ({
    id: r.id,
    weekStartDate: r.week_start_date,
    status: r.status,
    publishedAt: r.published_at,
    notes: r.notes,
  }));
}

function formatWeekLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return `Week of ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(parsed)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-slate-200/50 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
    published: {
      label: "Published",
      className: "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm",
    },
    archived: { label: "Archived", className: "bg-slate-200/50 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
  };
  const m = map[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
  return <Badge className={m.className}>{m.label}</Badge>;
}
