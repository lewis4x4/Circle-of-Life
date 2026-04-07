"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertCircle, Clock, ShieldAlert, Pill, FileWarning, Search, ChevronRight, CheckCircle2, UserCog, Activity } from "lucide-react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminDashboardSnapshot, type AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { MotionCard } from "@/components/ui/motion-card";

export default function AdminDashboardPage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      
      // CHUNK B: Role Router Logic
      const role = sessionData.session?.user?.app_metadata?.role || "facility_admin";
      
      // Post-login redirect logic to target workspaces
      if (role === 'owner' || role === 'org_admin') {
        router.replace('/admin/executive');
        return;
      }
      if (role === 'nurse' || role === 'caregiver') {
        router.replace('/admin/assessments/overdue'); // Clinical Desk
        return;
      }
      if (role === 'finance' || role === 'billing') {
        router.replace('/admin/finance');
        return;
      }
      const data = await fetchAdminDashboardSnapshot(selectedFacilityId);
      setSnapshot(data);
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : "Unable to load triage metrics.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center p-8 bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-900/50 max-w-md">
          <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">Triage Unavailable</h2>
          <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mb-4">{error ?? "Unable to load operational queues."}</p>
          <Button variant="outline" onClick={() => void load()}>Retry Connection</Button>
        </div>
      </div>
    );
  }

  // Derived triage metrics to enforce Exception-First Design
  const openIncidents = snapshot.openIncidentAlerts;
  // Mocking other triage numbers until Supabase views are updated
  const staffingGaps = 2; // Unstaffed critical shifts
  const medExceptions = 5; // Overdue meds
  const complianceAlerts = 1; // Expiring licenses

  const totalActionable = openIncidents + staffingGaps + medExceptions + complianceAlerts;

  return (
    <div className="space-y-8 pb-12 overflow-x-hidden">
      {/* Page Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            My Triage
            {totalActionable > 0 && (
              <Badge variant="destructive" className="ml-2 font-mono text-xs rounded-full px-2">
                {totalActionable} Requires Action
              </Badge>
            )}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {snapshot.headlineName} · Operational Queue
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 shadow-sm">
          <Button variant="ghost" size="sm" className="h-8 text-xs shrink-0">
            <Clock className="w-3.5 h-3.5 mr-2 text-slate-400" />
            {snapshot.shiftSummary}
          </Button>
          <div className="w-px h-4 bg-slate-200 dark:bg-slate-800" />
          <Button variant="ghost" size="sm" className="h-8 text-xs shrink-0text-slate-600">
            Timezone: {snapshot.timezoneLabel}
          </Button>
        </div>
      </div>

      {/* Triage Overview Metrics */}
      <MotionList className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MotionItem>
          <TriageMetricCard 
            title="Open Incidents" 
            value={openIncidents} 
            icon={ShieldAlert}
            href="/admin/incidents"
            urgency={openIncidents > 0 ? "critical" : "normal"} 
            subLabel={openIncidents > 0 ? "Pending investigation" : "All clear"}
          />
        </MotionItem>
        <MotionItem>
          <TriageMetricCard 
            title="Staffing Gaps" 
            value={staffingGaps} 
            icon={UserCog}
            href="/admin/staffing"
            urgency={staffingGaps > 0 ? "high" : "normal"} 
            subLabel="Next 48 hours"
          />
        </MotionItem>
        <MotionItem>
          <TriageMetricCard 
            title="Med Exceptions" 
            value={medExceptions} 
            icon={Pill}
            href="/admin/medications"
            urgency={medExceptions > 0 ? "medium" : "normal"} 
            subLabel="Overdue passes"
          />
        </MotionItem>
        <MotionItem>
          <TriageMetricCard 
            title="Compliance Risks" 
            value={complianceAlerts} 
            icon={FileWarning}
            href="/admin/compliance"
            urgency={complianceAlerts > 0 ? "high" : "normal"} 
            subLabel="Expiring today"
          />
        </MotionItem>
      </MotionList>

      {/* Main Inbox View */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Urgent Action Queue */}
        <MotionCard delay={0.2} className="col-span-2">
          <Card className="border-slate-200 shadow-sm dark:border-slate-800">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                  Action Queue
                </CardTitle>
                <CardDescription>Escalated items requiring your immediate sign-off</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {snapshot.activity.length === 0 && openIncidents === 0 ? (
                <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3 opacity-50" />
                  <p className="font-medium">Inbox Zero</p>
                  <p className="text-sm opacity-80">All operational exceptions resolved.</p>
                </div>
              ) : (
                <MotionList className="divide-y divide-slate-100 dark:divide-slate-800">
                  {/* Always shove unresolved incidents to the top of the queue */}
                  {snapshot.activity.filter(a => a.tone === "critical" || a.tone === "warning").map(event => (
                    <MotionItem key={event.id} className="flex items-start gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group">
                      <div className={cn(
                        "w-2 h-2 rounded-full mt-2 shrink-0 shadow-sm ring-4",
                        event.tone === "critical" ? "bg-rose-500 ring-rose-500/20" : "bg-amber-500 ring-amber-500/20"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {event.actor}
                          </span>
                          <span className="text-xs font-medium text-slate-400">{event.timeLabel}</span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                          {event.message}
                        </p>
                        <div className="flex items-center gap-2">
                          <Link href="/admin/incidents" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-[11px] font-medium px-3")}>
                            Review Root Cause
                          </Link>
                          <Button variant="ghost" size="sm" className="h-7 text-[11px] font-medium text-slate-500 hover:text-slate-900">
                            Transfer to Shift
                          </Button>
                        </div>
                      </div>
                    </MotionItem>
                  ))}
                  
                  {/* Mocked Staffing Exception to show Triage pattern */}
                  {staffingGaps > 0 && (
                    <MotionItem className="flex items-start gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group">
                      <div className="w-2 h-2 rounded-full mt-2 shrink-0 shadow-sm ring-4 bg-amber-500 ring-amber-500/20" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Staffing Hold
                          </span>
                          <span className="text-xs font-medium text-slate-400">Ends in 6 hrs</span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                          Night Shift CNA Call-out (West Wing) — Below Minimum HPPD
                        </p>
                        <div className="flex items-center gap-2">
                          <Link href="/admin/staffing" className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 text-[11px] font-medium px-3")}>
                            Authorize Double Shift
                          </Link>
                        </div>
                      </div>
                    </MotionItem>
                  )}
                </MotionList>
              )}
            </CardContent>
          </Card>
        </MotionCard>

        {/* Watchlist & Context (Right Sidebar) */}
        <div className="space-y-6">
          <Card className="border-slate-200 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-800 dark:text-slate-200">
                Acuity Watchlist
                <Link href="/admin/assessments/overdue" className="text-xs font-medium text-brand-600 hover:text-brand-700">View Roster</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                {snapshot.censusPreview.filter(r => r.acuity === 2 || r.acuity === 3).slice(0, 4).map(res => (
                  <div key={res.id} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-900/30">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <Avatar className="h-8 w-8 ring-1 ring-slate-200 dark:ring-slate-800">
                        <AvatarFallback className="text-[9px] bg-slate-100 text-slate-600 dark:bg-slate-800">{res.initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col truncate">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{res.name}</span>
                        <span className="text-[10px] text-slate-500">Room {res.room}</span>
                      </div>
                    </div>
                    {res.acuity === 3 ? (
                      <Badge variant="destructive" className="h-5 px-1.5 text-[9px] font-bold rounded-sm">CRITICAL</Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-bold rounded-sm border-amber-200 bg-amber-50 text-amber-700">OBSV</Badge>
                    )}
                  </div>
                ))}
                {snapshot.censusPreview.length === 0 && (
                  <p className="p-4 text-xs text-center text-slate-500">No high acuity residents currently.</p>
                )}
              </div>
            </CardContent>
          </Card>
          
          {/* Replaced static map with functional pipeline summary */}
          <Card className="border-slate-200 shadow-sm dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-900/20">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
              <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                Pipeline & Capacity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid gap-3">
               <div className="flex justify-between items-center bg-white dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                 <span className="text-sm text-slate-600 dark:text-slate-400">Total Census</span>
                 <span className="font-bold text-slate-900 dark:text-white">
                   {snapshot.licensedBeds ? `${snapshot.residentCount} / ${snapshot.licensedBeds}` : snapshot.residentCount}
                 </span>
               </div>
               <div className="flex justify-between items-center bg-white dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                 <span className="text-sm text-slate-600 dark:text-slate-400">Pending Move-Ins</span>
                 <span className="font-bold text-slate-900 dark:text-white">3</span>
               </div>
               <div className="flex justify-between items-center bg-white dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                 <span className="text-sm text-slate-600 dark:text-slate-400">LOA / Hospital</span>
                 <span className="font-bold text-amber-600 dark:text-amber-400">
                   {snapshot.censusPreview.filter(r => r.statusTone === "away").length}
                 </span>
               </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TriageMetricCard({ 
  title, value, icon: Icon, urgency, subLabel, href 
}: { 
  title: string; value: number; icon: any; urgency: "critical" | "high" | "medium" | "normal"; subLabel: string; href: string 
}) {
  const urgencyColors = {
    critical: "border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20 shadow-sm",
    high: "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 shadow-sm",
    medium: "border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20 shadow-sm",
    normal: "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 shadow-sm"
  };

  const textColors = {
    critical: "text-rose-700 dark:text-rose-400",
    high: "text-amber-700 dark:text-amber-400",
    medium: "text-blue-700 dark:text-blue-400",
    normal: "text-slate-600 dark:text-slate-400"
  };
  
  const iconColors = {
    critical: "text-rose-500",
    high: "text-amber-500",
    medium: "text-blue-500",
    normal: "text-slate-400"
  };

  return (
    <Link href={href} className="block group outline-none">
      <Card className={cn(
        "transition-all duration-200 hover:shadow-md hover:-translate-y-0.5", 
        urgencyColors[urgency]
      )}>
        <CardContent className="p-4 sm:p-5 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {title}
            </span>
            <div className="flex items-end gap-2">
              <span className={cn("text-3xl font-bold font-display tracking-tight leading-none", textColors[urgency])}>
                {value}
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-500">
              {subLabel}
            </span>
          </div>
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800",
          )}>
            <Icon className={cn("w-5 h-5", iconColors[urgency])} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
