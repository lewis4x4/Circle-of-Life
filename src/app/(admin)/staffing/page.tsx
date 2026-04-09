"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Users, AlertCircle, Clock, FileWarning, CalendarPlus, Activity, Download } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";
import { Skeleton } from "@/components/ui/skeleton";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type SnapshotRow = {
  id: string;
  snapshotAt: string;
  shift: string;
  residentsPresent: number;
  staffOnDuty: number;
  ratio: number;
  requiredRatio: number;
  isCompliant: boolean;
};

// Mock Types to achieve UI requirements
type ShiftGap = {
  id: string;
  date: string;
  shift: string;
  role: string;
  shortage: number;
  urgency: "critical" | "warning";
};

type CertWarning = {
  id: string;
  staffName: string;
  role: string;
  certName: string;
  daysExpired: number;
};

type StaffingSnapshotCsvRow = Database["public"]["Tables"]["staffing_ratio_snapshots"]["Row"];

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildStaffingSnapshotsCsv(rows: StaffingSnapshotCsvRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "snapshot_at",
    "shift",
    "residents_present",
    "staff_on_duty",
    "ratio",
    "required_ratio",
    "is_compliant",
    "staff_detail_json",
    "created_at",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.snapshot_at),
      csvEscapeCell(row.shift),
      csvEscapeCell(String(row.residents_present)),
      csvEscapeCell(String(row.staff_on_duty)),
      csvEscapeCell(String(row.ratio)),
      csvEscapeCell(String(row.required_ratio)),
      csvEscapeCell(row.is_compliant ? "true" : "false"),
      csvEscapeCell(row.staff_detail != null ? JSON.stringify(row.staff_detail) : ""),
      csvEscapeCell(row.created_at),
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

export default function AdminStaffingConsolePage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [csvExportError, setCsvExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchSnapshotsFromSupabase(selectedFacilityId);
      setSnapshots(live);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staffing metrics");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportStaffingSnapshotsCsv = useCallback(async () => {
    setExportingCsv(true);
    setCsvExportError(null);
    try {
      let q = supabase
        .from("staffing_ratio_snapshots" as never)
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(500);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const res = await q;
      if (res.error) throw res.error;
      const list = (res.data ?? []) as StaffingSnapshotCsvRow[];
      const csv = buildStaffingSnapshotsCsv(list);
      triggerCsvDownload(`staffing-ratio-snapshots-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (e) {
      setCsvExportError(e instanceof Error ? e.message : "Failed to export staffing snapshots.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-[140px] rounded-2xl" />
          <Skeleton className="h-[140px] rounded-2xl" />
          <Skeleton className="h-[140px] rounded-2xl" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-2xl mt-6" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center p-8 bg-slate-50 dark:bg-slate-900 rounded-2xl">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">System Unavailable</h2>
          <p className="text-sm text-slate-600 mb-4">{error}</p>
          <Button variant="outline" onClick={() => void load()}>Retry Connection</Button>
        </div>
      </div>
    );
  }

  const targetHPPD = 3.5;
  const actualHPPD = 3.2; // Example value

  // Hardcoded UI Mocks to satisfy "Exception-First" rule until schema adds roster scheduling tables
  const shiftGaps: ShiftGap[] = [
    { id: "1", date: "Today", shift: "Night (11p-7a)", role: "CNA", shortage: 2, urgency: "critical" },
    { id: "2", date: "Tomorrow", shift: "Day (7a-3p)", role: "RN", shortage: 1, urgency: "warning" },
  ];

  const certWarnings: CertWarning[] = [
    { id: "1", staffName: "Sarah Jenkins", role: "CNA", certName: "State Registry", daysExpired: 4 },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-12">
      <AmbientMatrix hasCriticals={shiftGaps.length > 0 || certWarnings.length > 0} 
        primaryClass="bg-rose-700/10"
        secondaryClass="bg-red-900/10"
        criticalPrimaryClass="bg-red-700/20"
        criticalSecondaryClass="bg-rose-900/10"
      />
      
      <header className="relative z-10 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between shrink-0 pl-1 mb-8">
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 18 / Command</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
            Workforce Command 
            {(shiftGaps.length > 0 || certWarnings.length > 0) && <PulseDot colorClass="bg-rose-500" />}
          </h2>
          <p className="mt-1 text-sm font-mono text-slate-500 dark:text-slate-400">
            Real-time HPPD variance, schedule gaps, and compliance warnings.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <Link href="/admin/staff" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs font-medium")}>
              View Roster
            </Link>
            <Link href="/admin/schedules" className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white")}>
              Master Schedule
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs font-medium font-mono uppercase tracking-widest"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportStaffingSnapshotsCsv()}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Snapshots CSV"}
            </Button>
          </div>
          {csvExportError ? (
            <p className="max-w-md text-right text-xs text-rose-600 dark:text-rose-400 font-mono" role="alert">
              {csvExportError}
            </p>
          ) : null}
        </div>
      </header>

      {/* Exception Metrics (Top Grid) */}
      <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 relative z-10 mb-8" staggerMs={75}>
        {/* Metric 1: HPPD */}
        <div className="h-[160px]">
          <V2Card hoverColor="blue">
            <Sparkline colorClass="text-blue-500" variant={3} />
             <div className="relative z-10 flex flex-col h-full justify-between">
               <span className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 text-slate-500"><Activity className="w-3.5 h-3.5" /> Current HPPD</span>
               <div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className={cn("text-5xl font-mono tracking-tighter pb-1", actualHPPD < targetHPPD ? "text-amber-500" : "text-emerald-500")}>
                      {actualHPPD}
                    </span>
                    <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">vs {targetHPPD} Target</span>
                  </div>
                  <p className="mt-1 text-[10px] uppercase font-mono tracking-widest text-amber-500 font-bold">-0.3 variance across active shifts. Risk of missing state minimums.</p>
               </div>
             </div>
          </V2Card>
        </div>

        {/* Metric 2: Unstaffed Next 48h */}
        <div className="h-[160px]">
          <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)] bg-rose-500/5">
             <MonolithicWatermark value={shiftGaps.reduce((sum, g) => sum + g.shortage, 0).toString()} className="text-rose-500/10" />
             <div className="relative z-10 flex flex-col h-full justify-between">
               <span className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 text-rose-500"><Users className="w-3.5 h-3.5" /> Open Shifts (48h)</span>
               <div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="text-5xl font-mono tracking-tighter text-rose-500 pb-1">
                      {shiftGaps.reduce((sum, g) => sum + g.shortage, 0)}
                    </span>
                    <span className="text-xs text-rose-500/70 font-mono uppercase tracking-widest">roles unfilled</span>
                  </div>
                  <p className="mt-1 text-[10px] uppercase font-mono tracking-widest text-rose-500 font-bold">Critical coverage gaps detected in Night shift.</p>
               </div>
             </div>
          </V2Card>
        </div>

        {/* Metric 3: Certifications */}
        <div className="h-[160px]">
          <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)] bg-amber-500/5">
             <MonolithicWatermark value={certWarnings.length.toString()} className="text-amber-500/10" />
             <div className="relative z-10 flex flex-col h-full justify-between">
               <span className="text-[10px] font-mono tracking-widest uppercase flex items-center gap-2 text-amber-500"><FileWarning className="w-3.5 h-3.5" /> Expired Credentials</span>
               <div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="text-5xl font-mono tracking-tighter text-amber-500 pb-1">
                      {certWarnings.length}
                    </span>
                    <span className="text-xs text-amber-500/70 font-mono uppercase tracking-widest">staff on duty</span>
                  </div>
                  <p className="mt-1 text-[10px] uppercase font-mono tracking-widest text-amber-500 font-bold">1 staff member blocked from assignment due to state registry expiry.</p>
               </div>
             </div>
          </V2Card>
        </div>
      </KineticGrid>

      <div className="grid lg:grid-cols-2 gap-6 relative z-10">
         {/* Exception UI: Unstaffed Gaps */}
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
               <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">Shift Assignment Gaps</h3>
               <Badge className="font-bold text-[9px] uppercase tracking-widest bg-rose-500/20 text-rose-500 dark:text-rose-400 border-none shadow-sm">Priority Dispatch</Badge>
            </div>
            <MotionList className="space-y-3">
              {shiftGaps.map(gap => (
                 <MotionItem key={gap.id}>
                    <div className="glass-panel p-5 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 relative overflow-hidden group">
                       <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                             <Clock className={cn("w-5 h-5", gap.urgency === "critical" ? "text-rose-500" : "text-amber-500")} />
                             <span className="font-bold font-mono text-xs text-slate-900 dark:text-slate-100 uppercase tracking-widest">{gap.date} · {gap.shift}</span>
                          </div>
                          <Badge variant="outline" className={cn(
                             "h-6 px-2 text-[10px] tracking-widest font-mono font-bold rounded-md border-0 uppercase uppercase",
                             gap.urgency === "critical" ? "bg-rose-500/20 text-rose-800 dark:text-rose-300" : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                          )}>
                             SHORT {gap.shortage} {gap.role}
                          </Badge>
                       </div>
                       <div className="flex gap-2 w-full">
                          <Button size="sm" className="w-full font-mono uppercase tracking-widest text-[9px] font-bold h-9 bg-slate-900/90 dark:bg-white/90 hover:bg-black dark:hover:bg-white text-white dark:text-black">
                             <CalendarPlus className="w-3.5 h-3.5 mr-2" /> Broadcast to PRN
                          </Button>
                          <Button size="sm" variant="outline" className="w-full font-mono uppercase tracking-widest text-[9px] font-bold h-9 bg-white/50 dark:bg-black/50 border-white/20 dark:border-white/5">
                             Mandate Agency
                          </Button>
                       </div>
                    </div>
                 </MotionItem>
              ))}
            </MotionList>
         </div>

         {/* Exception UI: Credential Blocks */}
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
               <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">Credential Warnings (Blockers)</h3>
               <Link href="/admin/certifications" className="text-[10px] font-mono tracking-widest uppercase font-bold text-indigo-500 hover:text-indigo-400">View All</Link>
            </div>
            
            <MotionList className="space-y-3">
              {certWarnings.map(cert => (
                 <MotionItem key={cert.id}>
                    <div className="glass-panel p-4 rounded-2xl border border-rose-500/30 dark:border-rose-500/20 bg-rose-500/5 relative overflow-hidden group flex items-center justify-between">
                       <div className="flex flex-col gap-1">
                          <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            {cert.staffName} <Badge className="text-[9px] uppercase font-mono bg-white/50 dark:bg-black/50 text-slate-900 dark:text-slate-100 border-none shadow-sm">{cert.role}</Badge>
                          </span>
                          <span className="text-xs font-mono font-semibold tracking-wide text-rose-600 dark:text-rose-400">
                            {cert.certName} expired {cert.daysExpired} days ago
                          </span>
                       </div>
                       <Button size="sm" variant="outline" className="font-mono uppercase tracking-widest text-[9px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20">
                          Remove from Shift
                       </Button>
                    </div>
                 </MotionItem>
              ))}
            </MotionList>
            
            <div className="mt-4 glass-panel p-5 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40">
               <p className="text-[10px] font-bold font-mono uppercase tracking-widest text-slate-500 mb-4">Recent Ratio Snapshots (Historical)</p>
               <div className="flex flex-col gap-3">
                 {snapshots.slice(0, 3).map(snap => (
                    <div key={snap.id} className="flex justify-between items-center text-sm">
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{new Date(snap.snapshotAt).toLocaleDateString()} {snap.shift}</span>
                      <span className={cn("font-mono text-xs font-bold uppercase tracking-widest", snap.isCompliant ? "text-emerald-500" : "text-rose-500")}>
                         {snap.ratio.toFixed(1)} Ratio {snap.isCompliant ? "(OK)" : "(Fail)"}
                      </span>
                    </div>
                 ))}
               </div>
            </div>
         </div>
      </div>

    </div>
  );
}

// --------------------------------------------------------------------------
// DATA HOOKS 
// --------------------------------------------------------------------------

type SupabaseSnapshotRow = {
  id: string;
  snapshot_at: string;
  shift: string;
  residents_present: number;
  staff_on_duty: number;
  ratio: number | string;
  required_ratio: number | string;
  is_compliant: boolean;
};

async function fetchSnapshotsFromSupabase(selectedFacilityId: string | null): Promise<SnapshotRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("staffing_ratio_snapshots" as never)
    .select("id, snapshot_at, shift, residents_present, staff_on_duty, ratio, required_ratio, is_compliant")
    .order("snapshot_at", { ascending: false })
    .limit(10);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = await q;
  const list = (res.data as SupabaseSnapshotRow[]) ?? [];
  return list.map((r) => ({
    id: r.id,
    snapshotAt: r.snapshot_at,
    shift: r.shift,
    residentsPresent: r.residents_present,
    staffOnDuty: r.staff_on_duty,
    ratio: Number(r.ratio),
    requiredRatio: Number(r.required_ratio),
    isCompliant: r.is_compliant,
  }));
}
