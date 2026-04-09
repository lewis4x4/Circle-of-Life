"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ClipboardList, Users } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";

export default function AdminInfectionControlHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [activeInf, setActiveInf] = useState(0);
  const [activeOut, setActiveOut] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [staffOut, setStaffOut] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setActiveInf(0);
        setActiveOut(0);
        setOpenAlerts(0);
        setStaffOut(0);
        return;
      }
      const [inf, out, va, ill] = await Promise.all([
        supabase
          .from("infection_surveillance")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .in("status", ["suspected", "confirmed"]),
        supabase
          .from("infection_outbreaks")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "active"),
        supabase
          .from("vital_sign_alerts")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "open"),
        supabase
          .from("staff_illness_records")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .is("absent_to", null),
      ]);
      setActiveInf(inf.count ?? 0);
      setActiveOut(out.count ?? 0);
      setOpenAlerts(va.count ?? 0);
      setStaffOut(ill.count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <AmbientMatrix hasCriticals={activeOut > 0} 
        primaryClass="bg-red-500/10" 
        secondaryClass="bg-orange-500/10"
      />

      <div className="relative z-10 space-y-6 max-w-6xl mx-auto">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 09 / Infection Surveillance</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Infection Control {activeOut > 0 && <PulseDot colorClass="bg-red-500" />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card className="border-red-500/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]" hoverColor="red">
              <Sparkline colorClass="text-red-500" variant={2} />
              <MonolithicWatermark value={loading ? 0 : activeInf} className="text-red-600/5 dark:text-red-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-red-600 dark:text-red-400 flex items-center gap-2">
                   Active Infections
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-red-600 dark:text-red-400 pb-1">{loading ? "—" : activeInf}</p>
              </div>
            </V2Card>
          </div>

          <div className="h-[160px]">
            <V2Card className={activeOut > 0 ? "border-amber-500/30 shadow-[inset_0_0_20px_rgba(245,158,11,0.1)]" : "border-slate-500/20"} hoverColor="amber">
              <Sparkline colorClass="text-amber-500" variant={3} />
              <MonolithicWatermark value={loading ? 0 : activeOut} className="text-amber-600/5 dark:text-amber-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                     Active Outbreaks
                  </h3>
                  {activeOut > 0 && <PulseDot colorClass="bg-amber-500" />}
                </div>
                <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">{loading ? "—" : activeOut}</p>
              </div>
            </V2Card>
          </div>

          <div className="h-[160px]">
            <V2Card hoverColor="blue" className="border-blue-500/20 shadow-[inset_0_0_15px_rgba(59,130,246,0.05)]">
              <Sparkline colorClass="text-blue-500" variant={1} />
              <MonolithicWatermark value={loading ? 0 : openAlerts} className="text-blue-600/5 dark:text-blue-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-blue-600 dark:text-blue-400">
                  Open Vital Alerts
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-blue-600 dark:text-blue-400 pb-1">{loading ? "—" : openAlerts}</p>
              </div>
            </V2Card>
          </div>

          <div className="h-[160px]">
            <V2Card hoverColor="slate" className="border-slate-500/20 shadow-[inset_0_0_15px_rgba(100,116,139,0.05)]">
              <Sparkline colorClass="text-slate-500" variant={4} />
              <MonolithicWatermark value={loading ? 0 : staffOut} className="text-slate-600/5 dark:text-slate-400/5 opacity-30" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 dark:text-slate-400">
                  Staff Out Sick
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-slate-600 dark:text-slate-300 pb-1">{loading ? "—" : staffOut}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/infection-control/new" className="group block focus-visible:outline-none">
          <div className="h-full glass-panel flex p-6 items-center gap-5 transition-all duration-300 hover:border-red-500/40 hover:bg-white/50 dark:hover:bg-red-900/10 cursor-pointer">
            <div className="rounded-2xl bg-red-100 dark:bg-red-900/30 p-4 shadow-sm border border-red-200/50 dark:border-red-500/20 group-hover:scale-110 transition-transform">
              <ClipboardList className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-red-700 dark:group-hover:text-red-400">
                New Surveillance
              </h3>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Record a suspected or confirmed infection</p>
            </div>
          </div>
        </Link>
        <Link href="/admin/infection-control/staff-illness" className="group block focus-visible:outline-none">
          <div className="h-full glass-panel flex p-6 items-center gap-5 transition-all duration-300 hover:border-blue-500/40 hover:bg-white/50 dark:hover:bg-blue-900/10 cursor-pointer">
            <div className="rounded-2xl bg-blue-100 dark:bg-blue-900/30 p-4 shadow-sm border border-blue-200/50 dark:border-blue-500/20 group-hover:scale-110 transition-transform">
              <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400">
                Staff Illness
              </h3>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Absences and return-to-work clearance</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-400">
        <Activity className="h-4 w-4 shrink-0" />
        <span>
          Configure per-resident thresholds from a resident →{" "}
          <Link href="/admin/residents" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
            Residents
          </Link>{" "}
          → Vitals / thresholds.
        </span>
      </div>

      {activeOut > 0 && !loading && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>There is an active outbreak in this facility scope. Review outbreak records in Supabase-backed lists (detail views coming).</span>
        </div>
      )}
      </div>
    </div>
  );
}
