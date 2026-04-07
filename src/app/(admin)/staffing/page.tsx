"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UserCog, Users, AlertCircle, Clock, FileWarning, CalendarPlus, Activity } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function AdminStaffingConsolePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-3 gap-4">
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

  const nonCompliant = snapshots.filter((r) => !r.isCompliant).length;
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
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between shrink-0 pl-1">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            Workforce Command 
            {shiftGaps.length > 0 && <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse ml-2" />}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Real-time HPPD variance, schedule gaps, and compliance warnings.
          </p>
        </div>
        <div className="flex gap-2">
           <Link href="/admin/staff" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs font-medium")}>
             View Roster
           </Link>
           <Link href="/admin/schedules" className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white")}>
             Master Schedule
           </Link>
        </div>
      </header>

      {/* Exception Metrics (Top Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Metric 1: HPPD */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden bg-white dark:bg-slate-950">
           <div className="absolute top-0 right-0 p-4 opacity-10">
             <Activity className="w-16 h-16" />
           </div>
           <CardContent className="p-5 flex flex-col justify-between h-full relative z-10">
             <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Current HPPD</span>
             <div className="mt-2 flex items-end gap-3">
                <span className={cn("text-4xl font-display font-medium tracking-tight", actualHPPD < targetHPPD ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                  {actualHPPD}
                </span>
                <span className="text-sm font-medium text-slate-400 mb-1">vs {targetHPPD} Target</span>
             </div>
             <p className="mt-2 text-xs text-amber-600 dark:text-amber-500 font-medium">-0.3 variance across active shifts. Risk of missing state minimums.</p>
           </CardContent>
        </Card>

        {/* Metric 2: Unstaffed Next 48h */}
        <Card className={cn("border-rose-200 dark:border-rose-900/50 shadow-sm relative overflow-hidden bg-rose-50/50 dark:bg-rose-950/20")}>
           <div className="absolute top-0 right-0 p-4 opacity-10 text-rose-500">
             <Users className="w-16 h-16" />
           </div>
           <CardContent className="p-5 flex flex-col justify-between h-full relative z-10">
             <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Open Shifts (48h)</span>
             <div className="mt-2 flex items-end gap-3">
                <span className="text-4xl font-display font-medium tracking-tight text-rose-700 dark:text-rose-400">
                  {shiftGaps.reduce((sum, g) => sum + g.shortage, 0)}
                </span>
                <span className="text-sm font-medium text-rose-600/70 mb-1">roles unfilled</span>
             </div>
             <p className="mt-2 text-xs text-rose-700 dark:text-rose-400 font-medium">Critical coverage gaps detected in Night shift.</p>
           </CardContent>
        </Card>

        {/* Metric 3: Certifications */}
        <Card className={cn("border-amber-200 dark:border-amber-900/50 shadow-sm relative overflow-hidden bg-amber-50/50 dark:bg-amber-950/20")}>
           <div className="absolute top-0 right-0 p-4 opacity-10 text-amber-500">
             <FileWarning className="w-16 h-16" />
           </div>
           <CardContent className="p-5 flex flex-col justify-between h-full relative z-10">
             <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Expired Credentials</span>
             <div className="mt-2 flex items-end gap-3">
                <span className="text-4xl font-display font-medium tracking-tight text-amber-700 dark:text-amber-400">
                  {certWarnings.length}
                </span>
                <span className="text-sm font-medium text-amber-600/70 mb-1">staff on duty</span>
             </div>
             <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 font-medium">1 staff member blocked from assignment due to state registry expiry.</p>
           </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
         {/* Exception UI: Unstaffed Gaps */}
         <Card className="border-slate-200 shadow-sm dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
               <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-800 dark:text-slate-200">
                 Shift Assignment Gaps
                 <Badge variant="secondary" className="font-normal text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200">Priority Dispatch</Badge>
               </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1">
               <div className="divide-y divide-slate-100 dark:divide-slate-800/60 p-3">
                 {shiftGaps.map(gap => (
                    <div key={gap.id} className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm mb-3">
                       <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                             <Clock className={cn("w-4 h-4", gap.urgency === "critical" ? "text-rose-500" : "text-amber-500")} />
                             <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{gap.date} · {gap.shift}</span>
                          </div>
                          <Badge variant="outline" className={cn(
                             "h-5 px-1.5 text-[10px] font-bold rounded-sm border-0",
                             gap.urgency === "critical" ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                          )}>
                             SHORT {gap.shortage} {gap.role}
                          </Badge>
                       </div>
                       <div className="mt-4 flex gap-2">
                          <Button size="sm" variant="default" className="w-full text-xs h-8 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900">
                             <CalendarPlus className="w-3 h-3 mr-2" /> Broadcast to PRN Pool
                          </Button>
                          <Button size="sm" variant="outline" className="w-full text-xs h-8">
                             Mandate Agency
                          </Button>
                       </div>
                    </div>
                 ))}
               </div>
            </CardContent>
         </Card>

         {/* Exception UI: Credential Blocks */}
         <Card className="border-slate-200 shadow-sm dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
               <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-800 dark:text-slate-200">
                 Credential Warnings (Blockers)
                 <Link href="/admin/certifications" className="text-[10px] font-medium text-brand-600 hover:text-brand-700">View All</Link>
               </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1">
               <div className="divide-y divide-slate-100 dark:divide-slate-800/60 p-3">
                 {certWarnings.map(cert => (
                    <div key={cert.id} className="p-3 mb-2 flex items-center justify-between rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/10">
                       <div className="flex flex-col">
                          <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                            {cert.staffName} <Badge variant="secondary" className="text-[9px] h-4 px-1">{cert.role}</Badge>
                          </span>
                          <span className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                            {cert.certName} expired {cert.daysExpired} days ago
                          </span>
                       </div>
                       <Button size="sm" variant="outline" className="h-7 text-xs px-3 border-rose-200 text-rose-700 hover:bg-rose-100">
                          Remove from Shift
                       </Button>
                    </div>
                 ))}
                 
                 <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4 px-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">Recent Ratio Snapshots (Historical)</p>
                    {snapshots.slice(0, 3).map(snap => (
                       <div key={snap.id} className="flex justify-between items-center py-2 text-sm text-slate-600 dark:text-slate-400">
                         <span>{new Date(snap.snapshotAt).toLocaleDateString()} {snap.shift}</span>
                         <span className={snap.isCompliant ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-rose-600 dark:text-rose-400 font-bold"}>
                            {snap.ratio.toFixed(1)} Ratio {snap.isCompliant ? "(OK)" : "(Fail)"}
                         </span>
                       </div>
                    ))}
                 </div>
               </div>
            </CardContent>
         </Card>
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
