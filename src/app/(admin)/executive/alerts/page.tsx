"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Clock, MapPin, CheckCircle2 } from "lucide-react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchExecutiveAlerts, acknowledgeExecutiveAlert, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import { cn } from "@/lib/utils";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

interface AlertWithFacility extends ExecutiveAlertRow {
  facilities?: { name: string } | null;
}

export default function ExecutiveAlertsPage() {
  const supabase = createClient();
  const ownerConfig = getRoleDashboardConfig("owner");
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ExecutiveAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        return;
      }
      const data = await fetchExecutiveAlerts(supabase, ctx.ctx.organizationId, selectedFacilityId, 100);
      setRows(data);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Unable to load alerts.");
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAck(alert: ExecutiveAlertRow) {
    setBusyId(alert.id);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in required.");
        return;
      }
      await acknowledgeExecutiveAlert(supabase, alert.id, user.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledge failed.");
    } finally {
      setBusyId(null);
    }
  }

  const criticals = rows.filter(r => r.severity === 'critical');
  const warnings = rows.filter(r => r.severity === 'warning');
  const infos = rows.filter(r => r.severity === 'info');
  const decisionLinks = [
    {
      title: "Finance review",
      description: "Check whether a financial exception or posting delay is amplifying the alert.",
      href: "/admin/finance",
    },
    {
      title: "Insurance & risk",
      description: "Open policy, renewal, and claims posture when the alert has risk implications.",
      href: "/admin/insurance",
    },
    {
      title: "High-severity incidents",
      description: "Jump into open incident exceptions when the alert needs operational intervention.",
      href: "/admin/incidents?scope=open&severity=level_4",
    },
  ];

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={criticals.length > 0} primaryClass="bg-amber-900/10" secondaryClass="bg-rose-900/10" />

      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Exception Engine</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                Executive Alerts
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">Workflow routing and leadership intervention queue</p>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                {ownerConfig.roleLabel} drill-in: review open exceptions, decide the intervention lane, and move into finance, insurance, or incident risk without dropping back to the operator home.
              </p>
            </div>
            <div className="hidden md:block">
              <ExecutiveHubNav />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {decisionLinks.map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="rounded-[1.5rem] border border-slate-200/70 bg-white/70 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg dark:border-white/5 dark:bg-white/[0.03] dark:hover:border-indigo-500/30"
            >
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-zinc-400">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">{item.description}</p>
            </Link>
          ))}
        </div>

        {error && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
            {error}
          </p>
        )}

        {/* Action Center Dash */}
        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={50}>
          <div className="h-[140px]">
             <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)] bg-rose-950/10 items-center justify-center flex flex-col text-center">
               <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 mb-2">
                 Critical Thresholds
               </h3>
               <p className="text-5xl font-mono tracking-tighter text-rose-600 dark:text-rose-500">{criticals.length}</p>
             </V2Card>
          </div>
          <div className="h-[140px]">
             <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)] bg-amber-950/10 items-center justify-center flex flex-col text-center">
               <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-500 mb-2">
                 Active Warnings
               </h3>
               <p className="text-5xl font-mono tracking-tighter text-amber-600 dark:text-amber-500">{warnings.length}</p>
             </V2Card>
          </div>
          <div className="h-[140px]">
             <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)] bg-indigo-950/10 items-center justify-center flex flex-col text-center">
               <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 mb-2">
                 Routing Actions
               </h3>
               <p className="text-5xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400">{infos.length}</p>
             </V2Card>
          </div>
        </KineticGrid>

        <div className="flex justify-between items-center mb-4 mt-8">
           <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
             Decision Queue
           </h3>
           <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh Queue
          </Button>
        </div>

        {loading ? (
           <div className="flex items-center justify-center py-20 text-slate-500 font-mono text-sm uppercase tracking-widest animate-pulse">
             Syncing Exception Engine...
           </div>
        ) : rows.length === 0 ? (
           <Card className="bg-emerald-950/5 border-emerald-500/20">
            <CardContent className="flex flex-col items-center justify-center p-16 text-center text-emerald-600 dark:text-emerald-500">
              <CheckCircle2 className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-semibold">Triage Queue Clear</p>
              <p className="text-sm mt-2 opacity-80">All interventions routed and resolved.</p>
            </CardContent>
          </Card>
        ) : (
           <div className="space-y-4">
              {rows.map((a) => {
                 const isCrit = a.severity === 'critical';
                 const isWarn = a.severity === 'warning';
                 const colorTag = isCrit ? 'rose' : isWarn ? 'amber' : 'slate';
                 
                 return (
                    <V2Card 
                       key={a.id} 
                       hoverColor={colorTag} 
                       className={cn(
                          "p-0 overflow-hidden",
                          isCrit ? "border-rose-500/30" : isWarn ? "border-amber-500/30" : "border-slate-500/30"
                       )}
                    >
                       <div className="flex flex-col md:flex-row">
                          <div className={cn(
                             "md:w-64 p-5 flex flex-col justify-center border-b md:border-b-0 md:border-r",
                             isCrit ? "bg-rose-500/5 border-rose-500/20" : isWarn ? "bg-amber-500/5 border-amber-500/20" : "bg-slate-500/5 border-slate-500/20"
                          )}>
                             <div className="flex items-center gap-2 mb-3">
                                <PulseDot colorClass={isCrit ? "bg-rose-500" : isWarn ? "bg-amber-500" : "bg-slate-500"} />
                                <span className={cn(
                                   "text-[10px] uppercase font-mono font-bold tracking-widest px-2 py-0.5 rounded",
                                   isCrit ? "bg-rose-500/20 text-rose-500" : isWarn ? "bg-amber-500/20 text-amber-500" : "bg-slate-500/20 text-slate-500"
                                )}>
                                   {a.severity}
                                </span>
                             </div>
                             <p className={cn("text-xs font-mono uppercase tracking-widest opacity-70", isCrit ? "text-rose-500" : isWarn ? "text-amber-500" : "text-slate-500")}>
                                Module • {a.source_module.replace(/_/g, " ")}
                             </p>
                          </div>
                          
                          <div className="flex-1 p-5 flex flex-col justify-between">
                             <div>
                                <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">{a.title}</h4>
                                {a.body && <p className="text-sm text-slate-600 dark:text-slate-400 max-w-3xl">{a.body}</p>}
                             </div>
                             
                             <div className="flex items-center justify-between mt-6">
                                <div className="text-[10px] font-mono tracking-widest text-slate-500 uppercase flex items-center gap-4">
                                   <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {format(new Date(a.created_at), 'MMM d, h:mm a')}</span>
                                   {(a as AlertWithFacility).facilities?.name && (
                                     <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {(a as AlertWithFacility).facilities!.name}</span>
                                   )}
                                </div>
                                
                                <div className="flex items-center gap-2">
                                   {a.deep_link_path && (
                                      <Link href={a.deep_link_path} className="text-xs font-semibold px-3 py-1.5 rounded bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 transition-colors">
                                         Inspect Source
                                      </Link>
                                   )}
                                   <Button
                                      size="sm"
                                      variant={a.acknowledged_at ? "outline" : isCrit ? "destructive" : "default"}
                                      disabled={busyId === a.id || !!a.acknowledged_at}
                                      onClick={() => void onAck(a)}
                                      className={cn(
                                         "h-8 text-xs font-semibold px-4",
                                         isWarn && !a.acknowledged_at ? "bg-amber-500 hover:bg-amber-600 text-amber-950" : ""
                                      )}
                                    >
                                      {a.acknowledged_at ? "Acknowledged" : busyId === a.id ? "Working…" : "Acknowledge"}
                                    </Button>
                                </div>
                             </div>
                          </div>
                       </div>
                    </V2Card>
                 )
              })}
           </div>
        )}

      </div>
    </div>
  );
}
