"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, Activity, BellRing } from "lucide-react";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { Badge } from "@/components/ui/badge";

export default function ResidentVitalsPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = createClient();
  const [logs, setLogs] = useState<
    {
      id: string;
      log_date: string;
      shift: string;
      temperature: number | null;
      blood_pressure_systolic: number | null;
      blood_pressure_diastolic: number | null;
      pulse: number | null;
      respiration: number | null;
      oxygen_saturation: number | null;
      weight_lbs: number | null;
    }[]
  >([]);
  const [alerts, setAlerts] = useState<{ id: string; vital_type: string; status: string; created_at: string }[]>([]);

  const load = useCallback(async () => {
    const [daily, va] = await Promise.all([
      supabase
        .from("daily_logs")
        .select(
          "id, log_date, shift, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, respiration, oxygen_saturation, weight_lbs",
        )
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("log_date", { ascending: false })
        .limit(30),
      supabase
        .from("vital_sign_alerts")
        .select("id, vital_type, status, created_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setLogs((daily.data ?? []) as never);
    setAlerts((va.data ?? []) as never);
  }, [supabase, residentId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href={`/admin/residents/${residentId}`}
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO PROFILE
             </Link>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Vitals
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400">
               Recent daily logs and vital alerts.
            </p>
          </div>
          <div>
            <Link
              href={`/admin/residents/${residentId}/vitals/thresholds`}
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg flex items-center gap-2")}
            >
              Alert Thresholds
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-3">
                <Activity className="h-5 w-5 text-brand-500" />
                Recent Daily Logs
              </h3>
              <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
                Temp, BP, Pulse, RR, O₂, Wt
              </p>
            </div>

            <div className="relative z-10 w-full overflow-hidden">
               <div className="hidden md:grid grid-cols-[1fr_0.5fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                 <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Date/Shift</div>
                 <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">BP / Pulse</div>
                 <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">O₂ / RR</div>
                 <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Temp</div>
                 <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Weight</div>
               </div>

               <div className="space-y-4 mt-6 relative z-10">
                 <MotionList className="space-y-4">
                   {logs.map((r) => (
                     <MotionItem key={r.id}>
                       <div className="grid grid-cols-1 md:grid-cols-[1fr_0.5fr_1fr_1fr_1fr] gap-4 md:items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                         
                         <div className="flex flex-col">
                           <span className="md:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Date/Shift</span>
                           <span className="font-semibold text-base text-slate-900 dark:text-slate-100">{r.log_date}</span>
                           <span className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">{r.shift}</span>
                         </div>

                         <div className="flex flex-col">
                           <span className="md:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">BP / Pulse</span>
                           <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{r.blood_pressure_systolic ?? "—"}/{r.blood_pressure_diastolic ?? "—"}</span>
                           <span className="text-xs text-slate-500 mt-0.5">{r.pulse ?? "—"} bpm</span>
                         </div>

                         <div className="flex flex-col">
                           <span className="md:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">O₂ / RR</span>
                           <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{r.oxygen_saturation ? `${r.oxygen_saturation}%` : "—"}</span>
                           <span className="text-xs text-slate-500 mt-0.5">{r.respiration ?? "—"} resp</span>
                         </div>

                         <div className="flex flex-col">
                           <span className="md:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Temp</span>
                           <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{r.temperature ? `${r.temperature}°` : "—"}</span>
                         </div>

                         <div className="flex flex-col md:items-end">
                           <span className="md:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Weight</span>
                           <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{r.weight_lbs ? `${r.weight_lbs} lbs` : "—"}</span>
                         </div>

                       </div>
                     </MotionItem>
                   ))}
                   {logs.length === 0 && (
                     <div className="p-8 text-center text-slate-500 dark:text-slate-400">No logs found.</div>
                   )}
                 </MotionList>
               </div>
            </div>
          </div>

          <div className="glass-panel border-rose-200/60 dark:border-rose-500/20 rounded-[2.5rem] bg-rose-50/50 dark:bg-rose-900/10 shadow-lg backdrop-blur-3xl overflow-hidden p-6 relative h-fit">
            <div className="mb-6 border-b border-rose-200 dark:border-rose-500/20 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-rose-900 dark:text-rose-100 mt-1 flex items-center gap-3">
                <BellRing className="h-5 w-5 text-rose-500" />
                Vital Alerts
              </h3>
            </div>
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="p-4 rounded-2xl bg-white dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 shadow-sm flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                     <span className="font-bold text-rose-900 dark:text-rose-200 uppercase tracking-widest text-[10px]">{a.vital_type}</span>
                     <Badge className="bg-rose-500 text-white uppercase tracking-widest font-bold text-[9px] px-2 shadow-none border-none">{a.status}</Badge>
                  </div>
                  <span className="text-xs font-mono text-rose-600 dark:text-rose-400 mt-2">{new Date(a.created_at).toLocaleString()}</span>
                </li>
              ))}
              {alerts.length === 0 && (
                <li className="text-rose-500/70 dark:text-rose-400/70 text-sm font-medium p-4 text-center">No alerts.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
