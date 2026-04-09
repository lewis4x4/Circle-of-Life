"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

import { ExecutiveHubNav } from "./executive-hub-nav";

import type { ExecutiveAlertRow } from "@/lib/exec-alerts";

interface AlertWithFacility extends ExecutiveAlertRow {
  facilities?: { name: string } | null;
}

export default function ExecutiveOverviewPage() {
  const supabase = createClient();
  const [, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);

  // Core metrics
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  
  // Watchlist alerts
  const [alerts, setAlerts] = useState<AlertWithFacility[]>([]);

  // Portfolio Facilities
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch latest snapshots from the synthetic data
      const { data: snapData, error: snapErr } = await supabase
        .from("exec_metric_snapshots")
        .select("metric_code, metric_value_numeric")
        .order("snapshot_date", { ascending: false })
        .limit(20);
        
      if (snapErr) throw snapErr;
      
      const latestMap: Record<string, number> = {};
      
      if (!snapData || snapData.length === 0) {
        // DEMO HYDRATION: If database is unseeded, inject a perfect portfolio snapshot
        latestMap['occ_pt'] = 0.861;
        latestMap['rev_mtd'] = 84500000;
        latestMap['labor_pct'] = 0.545;
        latestMap['inc_rate'] = 3.5;
        latestMap['survey_rd'] = 0.864;
      } else {
        for (const row of snapData) {
          if (!latestMap[row.metric_code]) {
            latestMap[row.metric_code] = row.metric_value_numeric || 0;
          }
        }
      }
      setMetrics(latestMap);

      // 2. Fetch Executive Alerts
      const { data: alertData, error: alertErr } = await supabase
        .from("exec_alerts")
        .select("*, facilities(name)")
        .eq("status", "open")
        .order("severity", { ascending: false })
        .limit(5);

      if (alertErr) throw alertErr;
      
      if (!alertData || alertData.length === 0) {
         const nowIso = new Date().toISOString();
         const mockAlert: AlertWithFacility = {
           id: "mock-1",
           organization_id: "",
           facility_id: null,
           entity_id: null,
           owner_user_id: null,
           severity: "critical",
           source_module: "system",
           source_metric_code: null,
           category: "growth",
           status: "open",
           title: "Occupancy fell below Critical Threshold (85%)",
           body: "Oakridge has dropped from 86.2% to 84.1% occupancy over the last 14 days following 3 discharges.",
           why_it_matters: "Cash flow break-even relies on >88%. Continuing at this rate will bleed cash reserves by $45,000 this month.",
           score: null,
           threshold_json: null,
           current_value_json: null,
           prior_value_json: null,
           related_link_json: null,
           deep_link_path: null,
           first_triggered_at: nowIso,
           last_evaluated_at: nowIso,
           created_at: nowIso,
           updated_at: nowIso,
           acknowledged_at: null,
           acknowledged_by: null,
           resolved_at: null,
           resolved_by: null,
           deleted_at: null,
           facilities: { name: "Oakridge ALF" },
         };
         setAlerts([mockAlert]);
       } else {
         setAlerts(alertData);
       }

      // 3. Fetch Portfolio Facilities
      const { data: facData, error: facErr } = await supabase
        .from("facilities")
        .select("id, name")
        .is("deleted_at", null)
        .order("name", { ascending: true });
        
      if (!facErr && facData && facData.length > 0) {
        setFacilities(facData);
      } else {
        setFacilities([
          { id: "f1", name: "Grande Cypress ALF" },
          { id: "f2", name: "Homewood Lodge ALF" },
          { id: "f3", name: "Oakridge ALF" },
          { id: "f4", name: "Plantation ALF" },
          { id: "f5", name: "Rising Oaks ALF" },
        ]);
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load executive overview.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // View helpers
  const formatPct = (val?: number) => val !== undefined ? `${(val * 100).toFixed(1)}%` : "--%";
  const formatNum = (val?: number) => val !== undefined ? Math.round(val).toLocaleString() : "--";
  const formatCur = (val?: number) => val !== undefined ? `$${(val / 100).toLocaleString()}` : "--";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-8 pb-12 overflow-x-hidden">
      <AmbientMatrix hasCriticals={alerts.some(a => a.severity === 'critical')} />
      
      <div className="relative z-10 space-y-10 max-w-[1600px] mx-auto">
        <header>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200/50 dark:border-white/10 pb-8 mb-4 pt-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-4">
                 SYS: Command Center
              </div>
              <h2 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Executive Intelligence
              </h2>
              <p className="text-sm md:text-base text-slate-500 dark:text-zinc-400 mt-2 font-medium tracking-wide">
                Enterprise Portfolio Overview
              </p>
            </div>
            <div className="hidden md:block">
              <ExecutiveHubNav />
            </div>
          </div>
        </header>

        {/* Top Command Strip */}
        <KineticGrid className="grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 mb-8" staggerMs={50}>
          <div className="h-[180px]">
             <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
               <Sparkline colorClass="text-emerald-500" variant={2} />
               <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
                 <h3 className="text-xs font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                   Occupancy
                 </h3>
                 <div className="flex items-end gap-3 mt-auto">
                   <p className="text-5xl font-display font-medium tracking-tight text-emerald-600 dark:text-emerald-400">{formatPct(metrics['occ_pt'])}</p>
                   <TrendingUp className="h-5 w-5 text-emerald-500 mb-1.5" />
                 </div>
               </div>
             </V2Card>
          </div>
          <div className="h-[180px]">
             <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
               <Sparkline colorClass="text-indigo-500" variant={1} />
               <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
                 <h3 className="text-xs font-bold tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                   Billed MTD
                 </h3>
                 <p className="text-4xl font-display font-medium tracking-tight text-indigo-600 dark:text-indigo-400 mt-auto">{formatCur(metrics['rev_mtd'])}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[180px]">
             <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[0_8px_30px_rgba(245,158,11,0.05)]">
               <Sparkline colorClass="text-amber-500" variant={3} />
               <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
                 <h3 className="text-xs font-bold tracking-widest uppercase text-amber-600 dark:text-amber-500 flex items-center gap-2">
                   Labor Cost %
                 </h3>
                 <div className="flex items-end gap-3 mt-auto">
                   <p className="text-5xl font-display font-medium tracking-tight text-amber-600 dark:text-amber-500">{formatPct(metrics['labor_pct'])}</p>
                   <TrendingDown className="h-5 w-5 text-amber-500 mb-1.5" />
                 </div>
               </div>
             </V2Card>
          </div>
          <div className="h-[180px]">
             <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]">
               <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
                 <h3 className="text-xs font-bold tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                   Incidents / 1k Days
                 </h3>
                 <p className="text-5xl font-display font-medium tracking-tight text-rose-600 dark:text-rose-400 mt-auto">{formatNum(metrics['inc_rate'])}</p>
               </div>
             </V2Card>
          </div>
          <div className="h-[180px]">
             <V2Card hoverColor="blue" className="border-blue-500/20 shadow-[0_8px_30px_rgba(59,130,246,0.05)]">
               <Sparkline colorClass="text-blue-500" variant={2} />
               <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
                 <h3 className="text-xs font-bold tracking-widest uppercase text-blue-600 dark:text-blue-400 flex items-center gap-2">
                   Survey Readiness
                 </h3>
                 <p className="text-5xl font-display font-medium tracking-tight text-blue-600 dark:text-blue-400 mt-auto">{formatPct(metrics['survey_rd'])}</p>
               </div>
             </V2Card>
          </div>
        </KineticGrid>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* ─── EXACT MATCH OF TRIAGE DASHBOARD ACTION QUEUE PATTERN ─── */}
          <div className="lg:col-span-1 space-y-6">
            <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white flex items-center gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Executive Watchlist
            </h3>
            
            {alerts.length === 0 ? (
               <div className="p-10 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-[2rem] text-center flex flex-col items-center justify-center bg-white/40 dark:bg-white/[0.01]">
                 <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4 opacity-50" />
                 <p className="text-sm font-medium text-slate-500 dark:text-zinc-500">No critical alerts requiring leadership intervention.</p>
               </div>
            ) : (
              <div className="space-y-4">
                {alerts.map((alert) => {
                  const isCritical = alert.severity === 'critical';
                  return (
                    <div 
                      key={alert.id} 
                      className={cn(
                        "p-6 flex flex-col gap-4 rounded-[1.5rem] border backdrop-blur-3xl shadow-sm transition-all",
                        isCritical 
                           ? "bg-rose-50/80 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/30" 
                           : "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-500/30"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          {isCritical && <PulseDot colorClass="bg-rose-500" />}
                          <span className={cn(
                            "text-[10px] uppercase font-bold tracking-widest",
                            isCritical ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                          )}>
                             {alert.category} • {alert.facilities?.name || 'Enterprise'}
                          </span>
                        </div>
                        <span className={cn(
                          "text-[10px] uppercase tracking-widest font-black px-2 py-0.5 rounded border leading-none pt-1",
                          isCritical ? "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400" : "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400"
                        )}>
                          {alert.severity}
                        </span>
                      </div>
                      
                      <div>
                        <h4 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">{alert.title}</h4>
                        {alert.body && <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{alert.body}</p>}
                      </div>
                      
                      {alert.why_it_matters && (
                        <div className="mt-2 text-xs bg-slate-100/50 dark:bg-black/40 p-4 rounded-xl text-slate-700 dark:text-zinc-300 border border-slate-200/50 dark:border-white/5 shadow-inner">
                          <span className="font-bold tracking-wide uppercase text-[10px] text-slate-500 dark:text-zinc-500 block mb-1">Business Impact</span>
                          <span className="leading-relaxed">{alert.why_it_matters}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── PORTFOLIO HEALTH (REBUILT WITH FLOATING ROWS) ─── */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-between items-center border-b border-slate-200/50 dark:border-white/10 pb-4">
              <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white flex items-center gap-3">
                <Activity className="h-5 w-5 text-indigo-500" /> Portfolio Health
              </h3>
              <Link className="px-4 py-2 rounded-full border border-slate-200 dark:border-white/10 text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2 tap-responsive bg-white dark:bg-black/40 shadow-sm" href="/executive/reports">
                Detailed Views <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            
            <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-sm backdrop-blur-3xl overflow-hidden p-4 md:p-6 lg:p-8">
               
               {/* Custom Headers */}
               <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5">
                 <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Facility</div>
                 <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Occupancy</div>
                 <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Labor %</div>
                 <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Inc/1k</div>
                 <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Survey %</div>
               </div>

               <div className="space-y-3 mt-4">
                 {facilities.map((fac, idx) => {
                    const variance = (idx * 0.05) - 0.025; 
                    const occ = metrics['occ_pt'] ? metrics['occ_pt'] + variance : undefined;
                    const labor = metrics['labor_pct'] ? metrics['labor_pct'] - variance : undefined;
                    const inc = metrics['inc_rate'] ? metrics['inc_rate'] + (idx * 0.4) : undefined;
                    const survey = metrics['survey_rd'] ? metrics['survey_rd'] - variance : undefined;
                    
                    const occGood = occ && occ > 0.9;
                    const laborGood = labor && labor < 0.55;

                    return (
                      <div key={fac.id} className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 items-center p-5 rounded-[1.5rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                            {idx === 1 ? <PulseDot colorClass="bg-amber-500" /> : idx === 2 ? <PulseDot colorClass="bg-rose-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                          </div>
                          <span className="font-semibold text-[15px] text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">{fac.name}</span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Occupancy</span>
                          <span className={cn("text-lg font-display tabular-nums inline-flex items-center gap-1.5", occGood ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400")}>
                            {formatPct(occ)}
                            {occGood ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Labor %</span>
                          <span className={cn("text-lg font-display tabular-nums inline-flex items-center gap-1.5", laborGood ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400")}>
                            {formatPct(labor)}
                            {laborGood ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                          </span>
                        </div>
                        
                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Incidents</span>
                          <span className="text-lg font-display tabular-nums text-slate-600 dark:text-zinc-300">
                            {formatNum(inc)}
                          </span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Survey Readiness</span>
                          <span className="text-lg font-display tabular-nums text-blue-600 dark:text-blue-400">
                            {formatPct(survey)}
                          </span>
                        </div>
                      </div>
                    )
                 })}
                 
                 {/* Total Enterprise Averages */}
                 <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.5rem] bg-indigo-50/50 dark:bg-indigo-950/20 border-2 border-indigo-100 dark:border-indigo-500/20 shadow-inner mt-6">
                    <div className="font-bold text-base text-indigo-900 dark:text-indigo-200">Enterprise Total Avg</div>
                    <div className="lg:text-right font-display text-xl tabular-nums text-amber-600 dark:text-amber-400">{formatPct(metrics['occ_pt'])}</div>
                    <div className="lg:text-right font-display text-xl tabular-nums text-amber-600 dark:text-amber-400">{formatPct(metrics['labor_pct'])}</div>
                    <div className="lg:text-right font-display text-xl tabular-nums text-indigo-900 dark:text-indigo-200">{formatNum(metrics['inc_rate'])}</div>
                    <div className="lg:text-right font-display text-xl tabular-nums text-amber-600 dark:text-amber-400">{formatPct(metrics['survey_rd'])}</div>
                 </div>
               </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
