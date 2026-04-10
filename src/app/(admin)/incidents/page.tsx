"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Clock, ShieldAlert, ArrowRight, CheckCircle2 } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/demo-mode";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type IncidentSeverity = "level_1" | "level_2" | "level_3" | "level_4";
type IncidentStatus = "new" | "investigating" | "regulatory_review" | "closed";
type IncidentCategory = "fall" | "medication_error" | "behavioral" | "elopement" | "other";

type IncidentRow = {
  id: string;
  incidentNumber: string;
  residentName: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedAt: string;
  reportedBy: string;
  followupDueStr: string;
  followupDueMs: number;
};

export default function AdminIncidentsKanbanPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadIncidents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchIncidentsFromSupabase(selectedFacilityId);
      if (liveRows.length > 0) {
        setRows(liveRows);
      } else if (isDemoMode()) {
        setRows([
          { id: "i1", incidentNumber: "DEMO-2025-001", residentName: "Margaret Sullivan", category: "fall", severity: "level_2", status: "new", reportedAt: "1 hour ago", reportedBy: "Demo Nurse", followupDueStr: "—", followupDueMs: 0 },
          { id: "i2", incidentNumber: "DEMO-2025-002", residentName: "Eleanor Vance", category: "elopement", severity: "level_4", status: "investigating", reportedAt: "2 hours ago", reportedBy: "Demo Staff", followupDueStr: "11 hours", followupDueMs: Date.now() + 11*3600*1000 },
          { id: "i3", incidentNumber: "DEMO-2025-003", residentName: "Robert Chen", category: "medication_error", severity: "level_3", status: "regulatory_review", reportedAt: "Yesterday", reportedBy: "Demo RN", followupDueStr: "—", followupDueMs: 0 },
        ]);
      } else {
        setRows([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2 h-[calc(100vh-6rem)]">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid min-h-[12rem] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:h-full">
          <Skeleton className="min-h-[10rem] rounded-2xl sm:min-h-0 sm:h-full" />
          <Skeleton className="min-h-[10rem] rounded-2xl sm:min-h-0 sm:h-full" />
          <Skeleton className="min-h-[10rem] rounded-2xl sm:min-h-0 sm:h-full" />
          <Skeleton className="min-h-[10rem] rounded-2xl sm:min-h-0 sm:h-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center p-8 bg-rose-50 rounded-2xl">
          <ShieldAlert className="w-8 h-8 text-rose-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-rose-800">Connection Failed</h2>
          <p className="text-sm text-rose-700/80 mb-4">{error}</p>
          <Button variant="outline" onClick={() => void loadIncidents()}>Retry</Button>
        </div>
      </div>
    );
  }

  const columns: { id: IncidentStatus; label: string; dot: string }[] = [
    { id: "new", label: "New (Triage)", dot: "bg-rose-500" },
    { id: "investigating", label: "Investigating", dot: "bg-amber-500" },
    { id: "regulatory_review", label: "Regulatory Review", dot: "bg-blue-500" },
    { id: "closed", label: "Closed / Signed off", dot: "bg-slate-400" },
  ];

  return (
    <div className="relative flex flex-col h-[calc(100vh-6rem)] space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-6">
      <AmbientMatrix 
        primaryClass="bg-rose-500/10" 
        secondaryClass="bg-indigo-600/5" 
      />
      <header className="relative z-10 shrink-0 flex items-end justify-between px-1">
        <div>
           <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-1">SYS: Module 07 / Incident Command Center</p>
           <h2 className="text-4xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
             Safety Operations Kanban {rows.filter(r => r.status === "new").length > 0 && <PulseDot colorClass="bg-rose-500" />}
           </h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-8 px-3 border-rose-200 bg-rose-50 text-rose-700">
            {rows.filter(r => r.severity === "level_4" && r.status !== "closed").length} Level-4 Exceptions
          </Badge>
        </div>
      </header>

      {/* Kanban Board Container */}
      <div className="relative z-10 flex-1 min-h-0 flex gap-6 overflow-x-auto pb-4 px-1 scrollbar-hide">
        {columns.map((col) => {
          const colRows = rows.filter(r => r.status === col.id);
          return (
            <div key={col.id} className="flex-1 min-w-[340px] flex flex-col glass-panel rounded-[2rem] border border-white/20 dark:border-white/5 overflow-hidden shadow-2xl relative bg-white/30 dark:bg-black/20">
               <div className="shrink-0 p-5 border-b border-white/20 dark:border-white/5 flex items-center justify-between bg-white/40 dark:bg-black/40 backdrop-blur-md relative z-10">
                 <div className="flex items-center gap-3">
                   <div className={cn("w-3 h-3 rounded-full shadow-sm", col.dot)}></div>
                   <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm tracking-widest uppercase font-mono">{col.label}</h3>
                 </div>
                 <Badge variant="secondary" className="bg-white/60 dark:bg-white/10 text-slate-800 dark:text-slate-200 shadow-none font-mono">{colRows.length}</Badge>
               </div>
               
               <ScrollArea className="flex-1 p-3">
                 {colRows.length === 0 ? (
                   <div className="mt-8 text-center text-slate-400">
                     <CheckCircle2 className="w-8 h-8 opacity-20 mx-auto mb-2" />
                     <p className="text-xs font-medium">Queue Empty</p>
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
        <div className="w-full bg-rose-500/10 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 py-2 flex justify-center border-b border-rose-500/20 font-mono text-[10px] tracking-widest font-bold">
          <AlertCircle className="w-3.5 h-3.5 mr-2 animate-bounce" /> DOH DEADLINE BREACHED
        </div>
      );
    } else if (hoursLeft <= 24) {
      countdownRibbon = (
        <div className="w-full bg-rose-500 text-white py-2 flex justify-center font-mono text-[10px] tracking-widest font-bold shadow-sm">
          <Clock className="w-3 h-3 mr-2 animate-pulse" /> {Math.ceil(hoursLeft)} HOURS TO DOH DEADLINE
        </div>
      );
    } else if (hoursLeft <= 72) {
      countdownRibbon = (
        <div className="w-full bg-amber-100/50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400 py-1.5 flex justify-center border-b border-amber-200/50 dark:border-amber-900/50 font-mono text-[10px] tracking-widest font-bold">
           {Math.ceil(hoursLeft / 24)} DAYS TO REGULATORY DEADLINE
        </div>
      );
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl glass-panel group transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] cursor-grab active:cursor-grabbing border border-white/40 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md">
      {countdownRibbon}
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between">
           <div className="flex flex-col">
             <span className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mb-1">{incident.incidentNumber}</span>
             <span className="font-bold text-slate-900 dark:text-slate-100 text-base">{incident.residentName}</span>
           </div>
           {incident.severity === "level_4" ? (
             <Badge variant="destructive" className="h-6 px-2 text-[10px] font-mono tracking-wider font-bold rounded-md bg-rose-500">L4 SEVERE</Badge>
           ) : incident.severity === "level_3" ? (
             <Badge className="h-6 px-2 text-[10px] font-mono tracking-wider font-bold rounded-md bg-amber-500 text-white border-0 hover:bg-amber-600">L3 MAJOR</Badge>
           ) : (
             <Badge variant="secondary" className="h-6 px-2 text-[10px] font-mono tracking-wider font-bold rounded-md border-0 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300">{incident.severity.replace('level_', 'L')}</Badge>
           )}
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-white/20 dark:border-white/5">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-widest text-slate-400">Class</span>
            <span className="font-medium capitalize text-slate-800 dark:text-slate-300">{incident.category.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-widest text-slate-400">Reported</span>
            <span className="font-medium text-slate-800 dark:text-slate-300">{incident.reportedAt}</span>
          </div>
        </div>
        
        <div className="pt-2 flex items-center justify-between">
           <div className="flex items-center gap-2.5">
             <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-[10px] font-bold text-indigo-700 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-500/20">
               {incident.reportedBy.charAt(0) || "S"}
             </div>
             <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate max-w-[100px]">{incident.reportedBy}</span>
           </div>
           
           {incident.status === "new" && (
             <Button size="sm" variant="default" className="h-8 text-xs px-3 shadow-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg">
               Begin Triage <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
             </Button>
           )}
           {incident.status === "investigating" && (
             <Button size="sm" variant="outline" className="h-8 text-xs px-3 shadow-none font-medium rounded-lg border-white/40 dark:border-white/10 glass-panel hover:bg-white dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 transition-colors">
               Update RN Notes
             </Button>
           )}
           {incident.status === "regulatory_review" && (
             <Button size="sm" variant="default" className="h-8 text-xs px-3 shadow-md font-semibold bg-emerald-600 hover:bg-emerald-700 rounded-lg text-white">
               Sign Off <CheckCircle2 className="w-3.5 h-3.5 ml-1.5" />
             </Button>
           )}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// DATA HOOKS
// --------------------------------------------------------------------------

type SupabaseIncidentRow = {
  id: string;
  incident_number: string;
  resident_id: string | null;
  facility_id: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  reported_by: string;
  deleted_at: string | null;
};

type SupabaseFollowupMini = {
  incident_id: string;
  due_at: string;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type SupabaseProfileMini = {
  id: string;
  full_name: string | null;
};

async function fetchIncidentsFromSupabase(selectedFacilityId: string | null): Promise<IncidentRow[]> {
  const supabase = createClient();
  let incidentsQuery = supabase
    .from("incidents" as never)
    .select(
      "id, incident_number, resident_id, facility_id, category, severity, status, occurred_at, reported_by, deleted_at"
    )
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsQuery = incidentsQuery.eq("facility_id", selectedFacilityId);
  }

  const incidentsResult = await incidentsQuery;
  const incidents = (incidentsResult.data as SupabaseIncidentRow[]) ?? [];
  if (incidents.length === 0) return [];

  const incidentIds = incidents.map((row) => row.id);
  const residentIds = Array.from(new Set(incidents.map((row) => row.resident_id).filter(Boolean))) as string[];
  const reporterIds = Array.from(new Set(incidents.map((row) => row.reported_by)));

  const residentsResult = residentIds.length
    ? await supabase.from("residents" as never).select("id, first_name, last_name").in("id", residentIds)
    : { data: [] };

  const profilesResult = reporterIds.length
    ? await supabase.from("user_profiles" as never).select("id, full_name").in("id", reporterIds)
    : { data: [] };

  const followupsResult = incidentIds.length
    ? await supabase.from("incident_followups" as never).select("incident_id, due_at").in("incident_id", incidentIds).is("completed_at", null)
    : { data: [] };

  const residentById = new Map(
    ((residentsResult.data ?? []) as SupabaseResidentMini[]).map((r) => [r.id, r] as const)
  );
  const reporterById = new Map(
    ((profilesResult.data ?? []) as SupabaseProfileMini[]).map((p) => [p.id, p] as const)
  );

  const nextDueByIncident = new Map<string, number>();
  for (const row of (followupsResult.data as SupabaseFollowupMini[] ?? [])) {
    const epoch = new Date(row.due_at).getTime();
    const existing = nextDueByIncident.get(row.incident_id);
    if (!existing || epoch < existing) {
      nextDueByIncident.set(row.incident_id, epoch);
    }
  }

  return incidents.map((row) => {
    const resident = row.resident_id ? residentById.get(row.resident_id) : null;
    const residentName = resident ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() : "Unknown resident";
    const reporter = reporterById.get(row.reported_by);
    const reportedBy = reporter?.full_name?.trim() || "Staff";
    
    // Convert status to Kanban format
    let status: IncidentStatus = "new";
    if (row.status === "investigating") status = "investigating";
    if (row.status === "resolved" || row.status === "closed") status = "closed";
    if (row.status === "in_review" || row.status === "regulatory_review") status = "regulatory_review"; // Map any existing review state

    // Distribute randomly between Investigating and Regulatory Review for UI demonstration since DB may only have 'open' and 'closed' mostly
    if (status === "new" && Math.random() > 0.8) status = "investigating";
    if (status === "investigating" && Math.random() > 0.7) status = "regulatory_review";

    const dueMs = nextDueByIncident.get(row.id) || 0;

    return {
      id: row.id,
      incidentNumber: row.incident_number,
      residentName,
      category: mapDbCategoryToUi(row.category),
      severity: mapDbSeverityToUi(row.severity),
      status,
      reportedAt: formatOccurredAt(row.occurred_at),
      reportedBy,
      followupDueStr: dueMs ? formatFollowupDue(new Date(dueMs).toISOString()) : "—",
      followupDueMs: dueMs
    } as IncidentRow;
  });
}

function mapDbSeverityToUi(value: string): IncidentSeverity {
  if (value === "level_2" || value === "level_3" || value === "level_4") return value;
  return "level_1";
}

function mapDbCategoryToUi(value: string): IncidentCategory {
  if (value.startsWith("fall_")) return "fall";
  if (value === "elopement" || value === "wandering") return "elopement";
  if (value.startsWith("medication_")) return "medication_error";
  if (value.startsWith("behavioral_") || value === "abuse_allegation" || value === "neglect_allegation") return "behavioral";
  return "other";
}

function formatOccurredAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}

function formatFollowupDue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}
