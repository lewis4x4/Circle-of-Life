"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { formatReportScheduleNextRunAt } from "@/lib/reports/reports-display-copy";
import { deriveReportScheduleState } from "@/lib/reports/report-status";
import { resolveReportTemplateIdBySlug } from "@/lib/reports/resolve-template-id";
import { computeNextRunUtc, decodeScheduleRule, encodeScheduleRule } from "@/lib/reports/schedule-preview";
import { formatTimeZoneLabel } from "@/lib/facility-wall-clock";
import type { ScheduleFrequency } from "@/lib/reports/pack-ui-metadata";
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
  last_error: string | null;
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
  const [recurrence, setRecurrence] = useState<ScheduleFrequency>("weekly");
  const timezone = "America/New_York";
  const [timeLocal, setTimeLocal] = useState("08:00");
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [saving, setSaving] = useState(false);
  const [sourceNames, setSourceNames] = useState<Record<string,string>>({});
  const outputFormat = "csv";
  const nextRuns = useMemo(() => {
    try { let now = new Date(); return Array.from({length:3}, () => { now=computeNextRunUtc({frequency:recurrence,weekday,monthDay,timeLocal,timezone,now}); return now.toLocaleString("en-US",{timeZone:timezone}); }); }
    catch { return []; }
  }, [recurrence,weekday,monthDay,timeLocal]);

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
        .select("id, source_type, source_id, timezone, recurrence_rule, status, output_format, next_run_at, last_run_at, last_error")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setSchedules((data ?? []) as Schedule[]);
      const [templates,packs] = await Promise.all([
        supabase.from("report_templates").select("id,name").or(`organization_id.is.null,organization_id.eq.${ctx.ctx.organizationId}`),
        supabase.from("report_packs").select("id,name").eq("organization_id",ctx.ctx.organizationId),
      ]);
      setSourceNames(Object.fromEntries([...(templates.data??[]),...(packs.data??[])].map(row=>[row.id,row.name])));
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
    setSaving(true);
    try {
      const resolved=await resolveReportTemplateIdBySlug(supabase,sourceId,orgId);
      if("error" in resolved) throw new Error(resolved.error);
      const rule={frequency:recurrence,weekday,monthDay,timeLocal};
      const {error:createErr}=await supabase.from("report_schedules").insert({
        organization_id:orgId,source_type:"template",source_id:resolved.id,timezone,
        recurrence_rule:encodeScheduleRule(rule),output_format:outputFormat,status:"active",
        next_run_at:computeNextRunUtc({...rule,timezone}).toISOString(),created_by:userId,updated_by:userId,
      });
      if(createErr) throw new Error(createErr.message);
    } catch(error) { setError(error instanceof Error?error.message:"Could not save schedule"); return; }
    finally { setSaving(false); }
    await load();
  }

  async function onToggleStatus(schedule: Schedule) {
    if (!orgId) return;
    const nextStatus = schedule.status === "active" ? "paused" : "active";
    let nextRunAt: string | undefined;
    if(nextStatus === "active") {
      try { nextRunAt=computeNextRunUtc({...decodeScheduleRule(schedule.recurrence_rule),timezone:schedule.timezone}).toISOString(); }
      catch { setError("This legacy schedule needs calendar timing. Create a replacement schedule or edit its pack before resuming."); return; }
    }
    const { error: updateErr } = await supabase
      .from("report_schedules")
      .update({ status: nextStatus, ...(nextRunAt ? {next_run_at:nextRunAt,last_error:null,output_format:"csv" as const} : {}) })
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
      <></>
      
      <div className="relative z-10 space-y-6 w-full">
        <ReportsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Scheduled Reports {schedules.some((s) => s.status === "paused") && <></>}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Configure recurring reports, pause or resume runs, and open saved results in History.
            </p>
          </div>
        </header>

      {error && <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-6 py-4 text-sm text-rose-600 dark:text-rose-400 font-medium w-full">{error}</p>}

      {canManage && (
        <div className="p-6 sm:p-8 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 shadow-sm relative overflow-visible mb-6 z-10 w-full transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Create Schedule</h3>
            <p className="text-sm font-mono tracking-wide mt-1 text-slate-500 dark:text-slate-400">Reports are saved in-app with CSV download. No email delivery is configured.</p>
          </div>
          <div className="grid gap-4 flex-col lg:flex-row lg:grid-cols-4 items-center">
            <div className="w-full relative">
              <select
                className="flex h-12 w-full rounded-2xl border border-slate-200 bg-card px-5 py-2 text-sm dark:border-white/10 shadow-inner focus:outline-none focus:ring-2 focus:ring-ring appearance-none font-mono uppercase tracking-wider text-[11px] font-bold text-slate-700 dark:text-slate-200"
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
            <label className="grid gap-1 text-sm">Frequency
              <select value={recurrence} onChange={event=>setRecurrence(event.target.value as ScheduleFrequency)} className="rounded border bg-card p-3">
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">Local time ({formatTimeZoneLabel(timezone)})<input type="time" value={timeLocal} onChange={event=>setTimeLocal(event.target.value)} className="rounded border bg-card p-3" /></label>
            {recurrence==="weekly" ? <label className="grid gap-1 text-sm">Day<select value={weekday} onChange={event=>setWeekday(Number(event.target.value))} className="rounded border bg-card p-3">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index)=><option key={day} value={index}>{day}</option>)}</select></label> : null}
            {recurrence==="monthly" || recurrence==="quarterly" ? <label className="grid gap-1 text-sm">Day of month<input type="number" min={1} max={31} value={monthDay} onChange={event=>setMonthDay(Number(event.target.value))} className="rounded border bg-card p-3" /></label> : null}
            <p className="lg:col-span-4 text-sm">Next runs: {nextRuns.length ? nextRuns.join(" · ") : "Choose valid timing"}. Short months use their final day.</p>
            <Button className="lg:col-span-4 rounded-2xl font-mono text-[11px] font-bold h-12 w-full hover:-translate-y-0.5 transition-transform shadow-lg" onClick={() => void onCreateSchedule()} disabled={saving || !nextRuns.length}>
              Save Schedule
            </Button>
          </div>
        </div>
      )}

      <section aria-labelledby="schedules-heading" className="w-full rounded-lg border border-border bg-card">
          <h2 id="schedules-heading" className="border-b border-border px-4 py-3 text-[15px] font-semibold text-foreground">
            Schedules
          </h2>
          {loading ? (
            <p className="px-4 py-10 text-sm text-muted-foreground">Loading schedules…</p>
          ) : schedules.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No schedules yet</p>
              <p className="mt-1">Set up a recurring report; each run is saved in the app with CSV download.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {schedules.map((schedule) => {
                const state = deriveReportScheduleState(schedule);
                return (
                  <li key={schedule.id} className="space-y-2 px-4 py-4 text-sm">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center md:gap-6">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{schedule.source_type === "pack" ? "Report pack" : "Report"}</p>
                        <p className="truncate font-medium text-foreground">{sourceNames[schedule.source_id] ?? "Report not available"}</p>
                      </div>
                      <div>
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Repeats</p>
                        <p className="text-foreground">{state.recurrenceLabel}</p>
                        <p className="text-xs text-muted-foreground">{formatTimeZoneLabel(schedule.timezone)} · {state.outputLabel}</p>
                      </div>
                      <div className="tabular-nums">
                        <p className="text-xs text-muted-foreground">{state.kind === "overdue" ? "Was due" : "Next run"}</p>
                        <p className={cn(state.kind === "overdue" ? "text-destructive" : "text-foreground")}>
                          {formatReportScheduleNextRunAt(schedule.next_run_at)}
                        </p>
                      </div>
                      <div className="flex md:justify-end">
                        <Button variant="outline" size="sm" onClick={() => void onToggleStatus(schedule)} disabled={!canManage}>
                          {schedule.status === "active" ? "Pause" : "Resume"}
                        </Button>
                      </div>
                    </div>
                    {state.problem ? (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">What is wrong: </span>
                        {state.problem}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
      </section>
      </div>
    </div>
  );
}
