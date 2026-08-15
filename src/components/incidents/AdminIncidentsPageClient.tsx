"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Clock, ShieldAlert, ArrowRight, CheckCircle2 } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  adminIncidentsGlobalEmptyNotice,
  adminIncidentsKanbanColumnEmptyHelper,
  adminIncidentsKanbanColumnEmptyTitle,
  adminIncidentsNoFacilityNotice,
  incidentFollowupDueBadgeText,
} from "@/lib/incidents/incidents-board-copy";
import {
  fetchIncidentsFromSupabase,
  type IncidentRow,
  type IncidentStatus,
} from "@/lib/incidents/load-incidents";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
type BoardScope = "all" | "active" | "open";

type AdminIncidentsPageClientProps = {
  initialRows: IncidentRow[];
  initialError: string | null;
  initialFacilityId: string | null;
};

export function AdminIncidentsPageClient({
  initialRows,
  initialError,
  initialFacilityId,
}: AdminIncidentsPageClientProps) {
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<IncidentRow[]>(initialRows);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [now, setNow] = useState<number>(() => Date.now());

  // Skip the first client-side fetch when the server already supplied data
  // for the current facility. Any later facility scope change falls through.
  const skipNextLoadRef = useRef(initialError == null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadIncidents = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchIncidentsFromSupabase(selectedFacilityId);
      setRows(liveRows);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2 h-[calc(100vh-6rem)]">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid min-h-[12rem] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:h-full">
          <Skeleton className="min-h-[10rem] rounded-[var(--radius)] sm:min-h-0 sm:h-full" />
          <Skeleton className="min-h-[10rem] rounded-[var(--radius)] sm:min-h-0 sm:h-full" />
          <Skeleton className="min-h-[10rem] rounded-[var(--radius)] sm:min-h-0 sm:h-full" />
          <Skeleton className="min-h-[10rem] rounded-[var(--radius)] sm:min-h-0 sm:h-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center p-8 bg-destructive/10 rounded-[var(--radius)]">
          <ShieldAlert className="w-8 h-8 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-destructive">Connection Failed</h2>
          <p className="text-sm text-destructive/70 mb-4">{error}</p>
          <Button variant="outline" onClick={() => void loadIncidents()}>Retry</Button>
        </div>
      </div>
    );
  }

  const requestedSeverity = searchParams.get("severity");
  const requestedScope = searchParams.get("scope");
  const severityFilter =
    requestedSeverity === "level_1" ||
    requestedSeverity === "level_2" ||
    requestedSeverity === "level_3" ||
    requestedSeverity === "level_4"
      ? requestedSeverity
      : "all";
  const scopeFilter: BoardScope =
    requestedScope === "active" || requestedScope === "open" ? requestedScope : "all";
  const visibleRows = rows.filter((row) => {
    const matchesSeverity = severityFilter === "all" || row.severity === severityFilter;
    const matchesScope =
      scopeFilter === "all" ||
      (scopeFilter === "active" ? row.status !== "closed" : row.status === "new" || row.status === "investigating");
    return matchesSeverity && matchesScope;
  });
  const columns: { id: IncidentStatus; label: string; dot: string }[] = [
    { id: "new", label: "New (Triage)", dot: "bg-destructive" },
    { id: "investigating", label: "Investigating", dot: "bg-warning" },
    { id: "regulatory_review", label: "Regulatory Review", dot: "bg-info" },
    { id: "closed", label: "Closed / Signed off", dot: "bg-muted-foreground/40" },
  ];
  const followupPressure = visibleRows
    .filter((row) => row.overdueFollowups > 0 || row.unassignedFollowups > 0 || row.openObligations > 0 || row.rootCausePending || row.carePlanPending)
    .sort((a, b) => {
      const aScore =
        a.criticalFollowups * 20 +
        a.escalatedFollowups * 12 +
        a.overdueFollowups * 10 +
        a.openObligations * 8 +
        (a.rootCausePending ? 6 : 0) +
        (a.carePlanPending ? 4 : 0) +
        a.unassignedFollowups * 3 +
        a.openFollowups;
      const bScore =
        b.criticalFollowups * 20 +
        b.escalatedFollowups * 12 +
        b.overdueFollowups * 10 +
        b.openObligations * 8 +
        (b.rootCausePending ? 6 : 0) +
        (b.carePlanPending ? 4 : 0) +
        b.unassignedFollowups * 3 +
        b.openFollowups;
      return bScore - aScore;
    })
    .slice(0, 5);
  const pressureBacklogHref =
    visibleRows.some((row) => row.openObligations > 0 || row.rootCausePending || row.carePlanPending)
      ? severityFilter === "all"
        ? scopeFilter === "all"
          ? "/admin/incidents/obligations"
          : `/admin/incidents/obligations?scope=${scopeFilter}`
        : scopeFilter === "all"
          ? `/admin/incidents/obligations?severity=${severityFilter}`
          : `/admin/incidents/obligations?severity=${severityFilter}&scope=${scopeFilter}`
      : visibleRows.some((row) => row.escalatedFollowups > 0)
        ? severityFilter === "all"
          ? scopeFilter === "all"
            ? "/admin/incidents/overdue-followups?filter=escalated"
            : `/admin/incidents/overdue-followups?filter=escalated&scope=${scopeFilter}`
          : scopeFilter === "all"
            ? `/admin/incidents/overdue-followups?filter=escalated&severity=${severityFilter}`
            : `/admin/incidents/overdue-followups?filter=escalated&severity=${severityFilter}&scope=${scopeFilter}`
        : visibleRows.some((row) => row.overdueFollowups > 0)
          ? severityFilter === "all"
            ? scopeFilter === "all"
              ? "/admin/incidents/overdue-followups"
              : `/admin/incidents/overdue-followups?scope=${scopeFilter}`
            : scopeFilter === "all"
              ? `/admin/incidents/overdue-followups?severity=${severityFilter}`
              : `/admin/incidents/overdue-followups?severity=${severityFilter}&scope=${scopeFilter}`
          : visibleRows.some((row) => row.unassignedFollowups > 0)
            ? severityFilter === "all"
              ? scopeFilter === "all"
                ? "/admin/incidents/followups?filter=unassigned"
                : `/admin/incidents/followups?filter=unassigned&scope=${scopeFilter}`
              : scopeFilter === "all"
                ? `/admin/incidents/followups?filter=unassigned&severity=${severityFilter}`
                : `/admin/incidents/followups?filter=unassigned&severity=${severityFilter}&scope=${scopeFilter}`
            : severityFilter === "all"
              ? scopeFilter === "all"
                ? "/admin/incidents/followups"
                : `/admin/incidents/followups?scope=${scopeFilter}`
              : scopeFilter === "all"
                ? `/admin/incidents/followups?severity=${severityFilter}`
                : `/admin/incidents/followups?severity=${severityFilter}&scope=${scopeFilter}`;
  const level4BadgeHref =
    severityFilter === "level_4"
      ? scopeFilter === "all"
        ? "/admin/incidents"
        : `/admin/incidents?scope=${scopeFilter}`
      : scopeFilter === "all"
        ? "/admin/incidents?severity=level_4&scope=active"
        : `/admin/incidents?severity=level_4&scope=${scopeFilter}`;
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);
  const level4ExceptionCount = rows.filter((row) => {
    if (row.severity !== "level_4") return false;
    if (scopeFilter === "all") return row.status !== "closed";
    if (scopeFilter === "active") return row.status !== "closed";
    return row.status === "new" || row.status === "investigating";
  }).length;

  return (
    <div className="relative flex flex-col h-[calc(100vh-6rem)] space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-duration)] pb-6">
      <></>
      <header className="relative z-10 shrink-0 flex items-end justify-between px-1">
        <div>
           
           <h2 className="text-4xl font-semibold tracking-tight text-foreground flex items-center gap-3">
             Safety Operations Kanban {visibleRows.filter(r => r.status === "new").length > 0 && <></>}
           </h2>
        </div>
        <div className="flex items-center gap-2">
          <Link href={level4BadgeHref}>
            <Badge variant="outline" className="h-8 px-3 border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer">
              {level4ExceptionCount} Level-4 Exceptions
            </Badge>
          </Link>
          <Link href={severityFilter === "all"
            ? scopeFilter === "all"
              ? "/admin/incidents/overdue-followups"
              : `/admin/incidents/overdue-followups?scope=${scopeFilter}`
            : scopeFilter === "all"
              ? `/admin/incidents/overdue-followups?severity=${severityFilter}`
              : `/admin/incidents/overdue-followups?severity=${severityFilter}&scope=${scopeFilter}`}>
            <Badge variant="outline" className="h-8 px-3 border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 cursor-pointer">
              {visibleRows.reduce((sum, row) => sum + row.overdueFollowups, 0)} Overdue follow-ups
            </Badge>
          </Link>
          <Link href={severityFilter === "all"
            ? scopeFilter === "all"
              ? "/admin/incidents/overdue-followups?filter=escalated"
              : `/admin/incidents/overdue-followups?filter=escalated&scope=${scopeFilter}`
            : scopeFilter === "all"
              ? `/admin/incidents/overdue-followups?filter=escalated&severity=${severityFilter}`
              : `/admin/incidents/overdue-followups?filter=escalated&severity=${severityFilter}&scope=${scopeFilter}`}>
            <Badge variant="outline" className="h-8 px-3 border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 cursor-pointer">
              {visibleRows.reduce((sum, row) => sum + row.escalatedFollowups, 0)} Escalated follow-ups
            </Badge>
          </Link>
          <Link href={severityFilter === "all"
            ? scopeFilter === "all"
              ? "/admin/incidents/followups"
              : `/admin/incidents/followups?scope=${scopeFilter}`
            : scopeFilter === "all"
              ? `/admin/incidents/followups?severity=${severityFilter}`
              : `/admin/incidents/followups?severity=${severityFilter}&scope=${scopeFilter}`}>
            <Badge variant="outline" className="h-8 px-3 border-info/30 bg-info/10 text-info hover:bg-info/20 cursor-pointer">
              {visibleRows.reduce((sum, row) => sum + row.openFollowups, 0)} Open follow-ups
            </Badge>
          </Link>
          <Link href={severityFilter === "all"
            ? scopeFilter === "all"
              ? "/admin/incidents/obligations"
              : `/admin/incidents/obligations?scope=${scopeFilter}`
            : scopeFilter === "all"
              ? `/admin/incidents/obligations?severity=${severityFilter}`
              : `/admin/incidents/obligations?severity=${severityFilter}&scope=${scopeFilter}`}>
            <Badge variant="outline" className="h-8 px-3 border-info/30 bg-info/10 text-info hover:bg-info/20 cursor-pointer">
              {visibleRows.filter((row) => row.openObligations > 0 || row.rootCausePending || row.carePlanPending).length} Lifecycle blockers
            </Badge>
          </Link>
          <Link href={severityFilter === "all"
            ? scopeFilter === "all"
              ? "/admin/incidents/followups?filter=unassigned"
              : `/admin/incidents/followups?filter=unassigned&scope=${scopeFilter}`
            : scopeFilter === "all"
              ? `/admin/incidents/followups?filter=unassigned&severity=${severityFilter}`
              : `/admin/incidents/followups?filter=unassigned&severity=${severityFilter}&scope=${scopeFilter}`}>
            <Badge variant="outline" className="h-8 px-3 border-border bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer">
              {visibleRows.reduce((sum, row) => sum + row.unassignedFollowups, 0)} Unassigned follow-ups
            </Badge>
          </Link>
        </div>
      </header>
      {severityFilter !== "all" || scopeFilter !== "all" ? (
        <div className="relative z-10 flex items-center gap-2 px-1">
          {scopeFilter !== "all" ? (
            <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
              Scope: {scopeFilter === "open" ? "open only" : "active only"}
            </Badge>
          ) : null}
          {severityFilter !== "all" ? (
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              Severity filter: {severityFilter.replace("level_", "L")}
            </Badge>
          ) : null}
          <Link href="/admin/incidents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
            Clear filters
          </Link>
        </div>
      ) : null}
      {!facilityReady ? (
        <div className="relative z-10 rounded-[var(--radius)] border border-border bg-card p-4 text-sm font-medium text-muted-foreground">
          {adminIncidentsNoFacilityNotice()}
        </div>
      ) : rows.length === 0 ? (
        <div className="relative z-10 rounded-[var(--radius)] border border-border bg-card p-4 text-sm font-medium text-muted-foreground">
          {adminIncidentsGlobalEmptyNotice()}
        </div>
      ) : null}

      {followupPressure.length > 0 && (
        <div className="relative z-10 rounded-[var(--radius)] border border-warning/20 bg-warning/10 p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-medium text-warning">Follow-up pressure</p>
                <p className="text-sm text-foreground">
                  These incidents still have unresolved follow-up, reporting, RCA, or care-plan workflow pressure.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-warning/10 text-warning border border-warning/30">
                  {followupPressure.length} incident{followupPressure.length === 1 ? "" : "s"} need attention
                </Badge>
                <Link href={pressureBacklogHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20")}>
                  Open backlog
                </Link>
                <Link
                  href={
                    severityFilter === "all"
                      ? scopeFilter === "all"
                        ? "/admin/incidents/obligations"
                        : `/admin/incidents/obligations?scope=${scopeFilter}`
                      : scopeFilter === "all"
                        ? `/admin/incidents/obligations?severity=${severityFilter}`
                        : `/admin/incidents/obligations?severity=${severityFilter}&scope=${scopeFilter}`
                  }
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "border-info/30 bg-info/10 text-info hover:bg-info/20")}
                >
                  Work obligations
                </Link>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {followupPressure.map((incident) => {
                const followupDueBadge = incidentFollowupDueBadgeText({
                  followupDueMs: incident.followupDueMs,
                  followupDueStr: incident.followupDueStr,
                });
                return (
                <Link
                  key={incident.id}
                  href={`/admin/incidents/${incident.id}`}
                  className="rounded-[var(--radius)] border border-border bg-card p-4 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 hover:-translate-y-px"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">{incident.incidentNumber}</p>
                      <p className="mt-1 font-semibold text-foreground">{incident.residentName}</p>
                    </div>
                    <Badge variant="outline" className="bg-muted text-muted-foreground border border-border">
                      {incident.openFollowups} open
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {incident.overdueFollowups > 0 ? (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border border-destructive/30">
                        {incident.overdueFollowups} overdue
                      </Badge>
                    ) : null}
                    {incident.unassignedFollowups > 0 ? (
                      <Badge variant="outline" className="bg-warning/10 text-warning border border-warning/30">
                        {incident.unassignedFollowups} unassigned
                      </Badge>
                    ) : null}
                    {incident.escalatedFollowups > 0 ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "bg-warning/10 text-warning border border-warning/30",
                          incident.criticalFollowups > 0 && "bg-destructive/10 text-destructive border border-destructive/30",
                        )}
                      >
                        {incident.criticalFollowups > 0
                          ? `${incident.criticalFollowups} critical`
                          : `${incident.escalatedFollowups} escalated`}
                      </Badge>
                    ) : null}
                    {followupDueBadge ? (
                      <Badge variant="outline" className="bg-info/10 text-info border border-info/30">
                        {followupDueBadge}
                      </Badge>
                    ) : null}
                    {incident.openObligations > 0 ? (
                      <Badge variant="outline" className="bg-info/10 text-info border border-info/30">
                        {incident.openObligations} reporting open
                      </Badge>
                    ) : null}
                    {incident.rootCausePending ? (
                      <Badge variant="outline" className="bg-muted text-muted-foreground border border-border">
                        RCA pending
                      </Badge>
                    ) : null}
                    {incident.carePlanPending ? (
                      <Badge variant="outline" className="bg-success/10 text-success border border-success/30">
                        Care plan pending
                      </Badge>
                    ) : null}
                  </div>
                </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board Container */}
      <div className="relative z-10 flex-1 min-h-0 flex gap-6 overflow-x-auto pb-4 px-1 scrollbar-hide">
        {columns.map((col) => {
          const colRows = visibleRows.filter(r => r.status === col.id);
          return (
            <div key={col.id} className="flex-1 min-w-[340px] flex flex-col rounded-[var(--radius)] border border-border overflow-hidden bg-card/40">
               <div className="shrink-0 p-4 border-b border-border flex items-center justify-between bg-card">
                 <div className="flex items-center gap-3">
                   <div className={cn("w-3 h-3 rounded-full shrink-0", col.dot)}></div>
                   <h3 className="text-[11px] font-medium text-foreground tracking-wider uppercase">{col.label}</h3>
                 </div>
                 <Badge variant="secondary" className="bg-muted text-muted-foreground shadow-none">{colRows.length}</Badge>
               </div>
               
               <ScrollArea className="flex-1 p-3">
                 {colRows.length === 0 ? (
                   <div className="mt-8 text-center text-muted-foreground px-2">
                     <CheckCircle2 className="w-8 h-8 opacity-20 mx-auto mb-2" />
                     <p className="text-xs font-medium">{adminIncidentsKanbanColumnEmptyTitle()}</p>
                     <p className="mt-1 text-[11px] text-muted-foreground/80">{adminIncidentsKanbanColumnEmptyHelper()}</p>
                   </div>
                 ) : (
                   <MotionList className="flex flex-col gap-3">
                     {colRows.map(incident => (
                       <MotionItem key={incident.id}>
                         <KanbanCard incident={incident} now={now} />
                       </MotionItem>
                     ))}
                   </MotionList>
                 )}
               </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({ incident, now }: { incident: IncidentRow; now: number }) {
  // Compute DOH Countdown using `now` lifted into parent state (updated every 60s)
  let countdownRibbon = null;
  
  if (incident.followupDueMs > 0 && incident.status !== "closed") {
    const hoursLeft = (incident.followupDueMs - now) / 3600000;
    if (hoursLeft < 0) {
      countdownRibbon = (
        <div className="w-full bg-destructive/10 text-destructive py-2 flex justify-center border-b border-destructive/20 font-medium text-[10px] tracking-wider font-bold">
          <AlertCircle className="w-3.5 h-3.5 mr-2" /> DOH DEADLINE BREACHED
        </div>
      );
    } else if (hoursLeft <= 24) {
      countdownRibbon = (
        <div className="w-full bg-destructive text-primary-foreground py-2 flex justify-center font-medium text-[10px] tracking-wider font-bold">
          <Clock className="w-3 h-3 mr-2 animate-pulse" /> {Math.ceil(hoursLeft)} HOURS TO DOH DEADLINE
        </div>
      );
    } else if (hoursLeft <= 72) {
      countdownRibbon = (
        <div className="w-full bg-warning/10 text-warning py-1.5 flex justify-center border-b border-warning/20 font-medium text-[10px] tracking-wider font-bold">
           {Math.ceil(hoursLeft / 24)} DAYS TO REGULATORY DEADLINE
        </div>
      );
    }
  }

  return (
    <Link href={`/admin/incidents/${incident.id}`} className="block">
    <div className="relative overflow-hidden rounded-[var(--radius)] transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] cursor-pointer border border-border bg-card shadow-[var(--shadow-card)] hover:-translate-y-px hover:shadow-[var(--shadow-lift)]">
      {countdownRibbon}
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between">
           <div className="flex flex-col">
             <span className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground mb-1">{incident.incidentNumber}</span>
             <span className="font-bold text-foreground text-base">{incident.residentName}</span>
           </div>
           {incident.severity === "level_4" ? (
             <Badge variant="destructive" className="h-6 px-2 text-[10px] tracking-wider font-bold rounded-md">L4 SEVERE</Badge>
           ) : incident.severity === "level_3" ? (
             <Badge className="h-6 px-2 text-[10px] tracking-wider font-bold rounded-md bg-warning text-primary-foreground border-0 hover:bg-warning/90">L3 MAJOR</Badge>
           ) : (
             <Badge variant="secondary" className="h-6 px-2 text-[10px] tracking-wider font-bold rounded-md border-0 bg-muted text-muted-foreground">{incident.severity.replace('level_', 'L')}</Badge>
           )}
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs bg-muted/40 p-3 rounded-[var(--radius)] border border-border">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Class</span>
            <span className="font-medium capitalize text-foreground">{incident.category.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Reported</span>
            <span className="font-medium text-foreground">{incident.reportedAt}</span>
          </div>
        </div>

        {(incident.openFollowups > 0 || incident.ahcaReportable) && (
          <div className="flex flex-wrap gap-2">
            {incident.openFollowups > 0 ? (
              <Badge variant="outline" className="bg-info/10 text-info border border-info/30">
                {incident.openFollowups} open follow-up{incident.openFollowups === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {incident.overdueFollowups > 0 ? (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border border-destructive/30">
                {incident.overdueFollowups} overdue
              </Badge>
            ) : null}
            {incident.unassignedFollowups > 0 ? (
              <Badge variant="outline" className="bg-warning/10 text-warning border border-warning/30">
                {incident.unassignedFollowups} unassigned
              </Badge>
            ) : null}
            {incident.escalatedFollowups > 0 ? (
              <Badge
                variant="outline"
                className={cn(
                  "bg-warning/10 text-warning border border-warning/30",
                  incident.criticalFollowups > 0 && "bg-destructive/10 text-destructive border border-destructive/30",
                )}
              >
                {incident.criticalFollowups > 0 ? `${incident.criticalFollowups} critical` : `${incident.escalatedFollowups} escalated`}
              </Badge>
            ) : null}
            {incident.ahcaReportable && !incident.ahcaReported ? (
              <Badge variant="outline" className="bg-info/10 text-info border border-info/30">
                AHCA reporting open
              </Badge>
            ) : null}
            {incident.openObligations > 0 ? (
              <Badge variant="outline" className="bg-info/10 text-info border border-info/30">
                {incident.openObligations} reporting / notify
              </Badge>
            ) : null}
            {incident.rootCausePending ? (
              <Badge variant="outline" className="bg-muted text-muted-foreground border border-border">
                RCA pending
              </Badge>
            ) : null}
            {incident.carePlanPending ? (
              <Badge variant="outline" className="bg-success/10 text-success border border-success/30">
                Care plan pending
              </Badge>
            ) : null}
          </div>
        )}
        
        <div className="pt-2 flex items-center justify-between">
           <div className="flex items-center gap-2.5">
             <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground border border-border">
               {incident.reportedBy.charAt(0) || "S"}
             </div>
             <span className="text-xs font-medium text-muted-foreground truncate max-w-[100px]">{incident.reportedBy}</span>
           </div>
           
           {incident.status === "new" && (
             <Button size="sm" variant="default" className="h-8 text-xs px-3 font-semibold">
               Begin Triage <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
             </Button>
           )}
           {incident.status === "investigating" && (
             <Button size="sm" variant="outline" className="h-8 text-xs px-3 font-medium">
               Manage Follow-ups
             </Button>
           )}
           {incident.status === "regulatory_review" && (
             <Button size="sm" variant="default" className="h-8 text-xs px-3 font-semibold">
               Review Next Steps <CheckCircle2 className="w-3.5 h-3.5 ml-1.5" />
             </Button>
           )}
        </div>
      </div>
    </div>
    </Link>
  );
}
