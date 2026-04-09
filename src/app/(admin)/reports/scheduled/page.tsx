"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Schedule = {
  id: string;
  source_type: string;
  source_id: string;
  timezone: string;
  recurrence_rule: string;
  status: string;
  output_format: string;
  next_run_at: string | null;
  last_run_at: string | null;
};

export default function ScheduledReportsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [sourceId, setSourceId] = useState(searchParams.get("fromTemplate") ?? PHASE1_TEMPLATE_SEED[0]?.slug ?? "");
  const [recurrence, setRecurrence] = useState("weekly");
  const [timezone, setTimezone] = useState("America/New_York");
  const [outputFormat, setOutputFormat] = useState("pdf");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setOrgId(ctx.ctx.organizationId);
      setUserId(ctx.ctx.userId);
      setCanManage(canManageReports(ctx.ctx.appRole));

      const { data, error: queryErr } = await supabase
        .from("report_schedules")
        .select("id, source_type, source_id, timezone, recurrence_rule, status, output_format, next_run_at, last_run_at")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setSchedules((data ?? []) as Schedule[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreateSchedule() {
    if (!orgId || !userId) return;
    setError(null);
    const { error: createErr } = await supabase.from("report_schedules").insert({
      organization_id: orgId,
      source_type: "template",
      source_id: sourceId,
      timezone,
      recurrence_rule: recurrence,
      output_format: outputFormat as "csv" | "pdf" | "print" | "xlsx",
      status: "active",
      next_run_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: userId,
      updated_by: userId,
    });
    if (createErr) {
      setError(createErr.message);
      return;
    }
    await load();
  }

  async function onToggleStatus(schedule: Schedule) {
    if (!orgId) return;
    const nextStatus = schedule.status === "paused" ? "active" : "paused";
    const { error: updateErr } = await supabase
      .from("report_schedules")
      .update({ status: nextStatus })
      .eq("id", schedule.id)
      .eq("organization_id", orgId);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <AmbientMatrix hasCriticals={schedules.some((s) => s.status === "paused")} 
        primaryClass="bg-amber-700/10"
        secondaryClass="bg-indigo-900/5"
      />
      
      <div className="relative z-10 space-y-6 max-w-7xl mx-auto">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Scheduled Reports {schedules.some((s) => s.status === "paused") && <PulseDot colorClass="bg-amber-500" />}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Configure recurring runs, pause/resume delivery, and track run cadence.
            </p>
          </div>
        </header>

      {error && <p className="rounded-[1.5rem] border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium max-w-7xl mx-auto">{error}</p>}

      {canManage && (
        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible mb-6 z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Create Schedule</h3>
            <p className="text-sm font-mono tracking-wide mt-1 text-slate-500 dark:text-slate-400">Phase 1 supports template schedules with in-app delivery tracking.</p>
          </div>
          <div className="grid gap-4 flex-col lg:flex-row lg:grid-cols-4 items-center">
            <div className="w-full relative">
              <select
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white/60 px-5 py-2 text-sm dark:border-white/10 dark:bg-black/30 backdrop-blur-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-mono uppercase tracking-widest text-[11px] font-bold text-slate-700 dark:text-slate-200"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {PHASE1_TEMPLATE_SEED.map((template) => (
                  <option key={template.slug} value={template.slug} className="dark:bg-slate-900 font-sans tracking-normal capitalize text-sm font-medium">
                    {template.name}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400 font-bold">
                 ↓
              </div>
            </div>
            <input className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-black/30 px-5 py-2 text-sm backdrop-blur-xl shadow-inner focus-visible:ring-indigo-500 font-mono tracking-wide" value={recurrence} onChange={(event) => setRecurrence(event.target.value)} placeholder="daily | weekly | monthly" />
            <input className="h-12 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-black/30 px-5 py-2 text-sm backdrop-blur-xl shadow-inner focus-visible:ring-indigo-500 font-mono tracking-wide" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/New_York" />
            <div className="w-full relative">
              <select
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white/60 px-5 py-2 text-sm dark:border-white/10 dark:bg-black/30 backdrop-blur-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-mono uppercase tracking-widest text-[11px] font-bold text-slate-700 dark:text-slate-200"
                value={outputFormat}
                onChange={(event) => setOutputFormat(event.target.value)}
              >
                <option value="pdf" className="dark:bg-slate-900 font-sans tracking-normal uppercase text-sm font-medium">PDF</option>
                <option value="csv" className="dark:bg-slate-900 font-sans tracking-normal uppercase text-sm font-medium">CSV</option>
                <option value="xlsx" className="dark:bg-slate-900 font-sans tracking-normal uppercase text-sm font-medium">XLSX</option>
              </select>
               <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400 font-bold">
                 ↓
               </div>
            </div>
            <Button className="lg:col-span-4 rounded-2xl font-mono uppercase tracking-widest text-[11px] font-bold h-12 w-full hover:-translate-y-0.5 transition-transform shadow-lg" onClick={() => void onCreateSchedule()}>
              Save Schedule
            </Button>
          </div>
        </div>
      )}

      <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-visible z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Active Configurations</h3>
          </div>
          {loading ? (
            <div className="p-16 text-center text-slate-500">
               <p className="text-sm font-mono tracking-widest uppercase">Loading Schedules…</p>
            </div>
          ) : schedules.length === 0 ? (
            <div className="p-16 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Schedules Configured</p>
               <p className="text-sm opacity-80 mt-1 font-mono tracking-wide">Set up recurring dispatches for critical reports.</p>
             </div>
          ) : (
            <MotionList className="space-y-4">
                {schedules.map((schedule) => (
                  <MotionItem key={schedule.id}>
                    <div className={cn("p-6 rounded-[1.5rem] glass-panel group transition-all duration-300 hover:scale-[1.01] cursor-default border w-full flex flex-col xl:flex-row xl:items-center justify-between gap-6 backdrop-blur-xl shadow-sm hover:shadow-md", schedule.status === "paused" ? "border-amber-500/20 bg-amber-50 dark:bg-amber-900/10 hover:border-amber-500/40" : "border-slate-200 dark:border-white/5 bg-white/80 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20")}>
                        <div className="absolute top-0 left-0 w-1 h-full rounded-l-full bg-emerald-500/0 transition-colors" />
                        <div className="flex flex-col min-w-[200px] gap-1 shrink-0">
                           <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Source configuration</span>
                           <span className="font-bold text-slate-900 dark:text-slate-100 text-sm tracking-wide capitalize">
                              {schedule.source_id.replace(/-/g, ' ')}
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full items-center">
                           <div className="flex flex-col gap-2">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Status</span>
                              <div>
                                <Badge className={cn("uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2.5 py-1 rounded-full", schedule.status === "active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ring-1 ring-emerald-500/20" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 ring-1 ring-amber-500/20")}>
                                  {schedule.status}
                                </Badge>
                              </div>
                           </div>
                           <div className="flex flex-col gap-2 align-left md:text-left">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Recurrence</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-700 dark:text-slate-300">{schedule.recurrence_rule}</span>
                                <Badge className="bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2 py-0.5 rounded-full shrink-0">
                                   {schedule.output_format}
                                </Badge>
                              </div>
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Timezone</span>
                              <span className="font-mono text-[11px] font-medium tracking-wide text-slate-600 dark:text-slate-300">{schedule.timezone}</span>
                           </div>
                           <div className="flex flex-col gap-2 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Scheduled Dispatch</span>
                              <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-widest">{schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString() : "—"}</span>
                           </div>
                        </div>

                        <div className="flex shrink-0 xl:ml-4 gap-3 mt-4 xl:mt-0">
                           <Button variant="outline" size="sm" onClick={() => void onToggleStatus(schedule)} className={cn("font-mono uppercase tracking-widest text-[10px] h-10 rounded-xl font-bold bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 w-full sm:w-auto hover:bg-slate-50 dark:hover:bg-white/10 shadow-sm transition-colors px-6 w-full lg:w-auto", schedule.status === "paused" ? "bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/50" : "")}>
                             {schedule.status === "paused" ? "Resume" : "Pause"}
                           </Button>
                        </div>
                    </div>
                  </MotionItem>
                ))}
            </MotionList>
          )}
      </div>
      </div>
    </div>
  );
}
