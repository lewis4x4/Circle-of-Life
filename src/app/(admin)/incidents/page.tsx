"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpDown, ChevronRight, ShieldAlert } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type IncidentSeverity = "level_1" | "level_2" | "level_3" | "level_4";
type IncidentStatus = "open" | "in_review" | "closed";
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
  followupDue: string;
};

const DEFAULT_FILTERS = {
  search: "",
  severity: "all",
  status: "all",
  category: "all",
};

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

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type SupabaseProfileMini = {
  id: string;
  full_name: string | null;
};

type SupabaseFollowupMini = {
  incident_id: string;
  due_at: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export default function AdminIncidentsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [severity, setSeverity] = useState(DEFAULT_FILTERS.severity);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [category, setCategory] = useState(DEFAULT_FILTERS.category);

  const loadIncidents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchIncidentsFromSupabase(selectedFacilityId);
      setRows(liveRows.length > 0 ? liveRows : mockIncidents);
    } catch {
      setRows(mockIncidents);
      setError("Live incident data is unavailable. Showing demo queue data.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  const filteredRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.incidentNumber.toLowerCase().includes(loweredSearch) ||
        row.residentName.toLowerCase().includes(loweredSearch) ||
        row.reportedBy.toLowerCase().includes(loweredSearch);
      const matchesSeverity = severity === "all" || row.severity === severity;
      const matchesStatus = status === "all" || row.status === status;
      const matchesCategory = category === "all" || row.category === category;
      return matchesSearch && matchesSeverity && matchesStatus && matchesCategory;
    });
  }, [rows, search, severity, status, category]);

  const openCount = rows.filter((row) => row.status !== "closed").length;
  const criticalCount = rows.filter((row) => row.severity === "level_4").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Incident Command
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Triage, follow-up, and severity review queue for reportable and internal incident workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-slate-200 bg-white px-3 py-1 dark:border-slate-800 dark:bg-slate-900"
          >
            <ShieldAlert className="mr-1 h-3.5 w-3.5" />
            {openCount} active queue
          </Badge>
          <Badge
            variant="outline"
            className="border-red-200 bg-red-50 px-3 py-1 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          >
            <AlertTriangle className="mr-1 h-3.5 w-3.5" />
            {criticalCount} critical
          </Badge>
        </div>
      </header>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search incident #, resident, or reporter..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "severity",
            value: severity,
            onChange: setSeverity,
            options: [
              { value: "all", label: "All Severities" },
              { value: "level_1", label: "Severity 1" },
              { value: "level_2", label: "Severity 2" },
              { value: "level_3", label: "Severity 3" },
              { value: "level_4", label: "Severity 4" },
            ],
          },
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All Statuses" },
              { value: "open", label: "Open" },
              { value: "in_review", label: "In Review" },
              { value: "closed", label: "Closed" },
            ],
          },
          {
            id: "category",
            value: category,
            onChange: setCategory,
            options: [
              { value: "all", label: "All Categories" },
              { value: "fall", label: "Fall" },
              { value: "medication_error", label: "Medication Error" },
              { value: "behavioral", label: "Behavioral" },
              { value: "elopement", label: "Elopement" },
              { value: "other", label: "Other" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setSeverity(DEFAULT_FILTERS.severity);
          setStatus(DEFAULT_FILTERS.status);
          setCategory(DEFAULT_FILTERS.category);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState
          title="No incidents match the current filters"
          description="Try broadening severity, status, or category. Live data is scoped by your current facility selection."
        />
      ) : null}

      {!isLoading && filteredRows.length > 0 ? (
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30">
            <CardTitle className="text-lg font-display">Incident Queue</CardTitle>
            <CardDescription>Inbox-style command table for review, escalation, and follow-up ownership.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/70 dark:bg-slate-900/60">
                <TableRow className="border-slate-100 hover:bg-transparent dark:border-slate-800">
                  <TableHead className="pl-4 font-medium">Incident #</TableHead>
                  <TableHead className="font-medium">Resident</TableHead>
                  <TableHead className="font-medium">Category</TableHead>
                  <TableHead className="font-medium">Severity</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium">Reporter</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Reported
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="font-medium">Follow-up Due</TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((incident) => (
                  <TableRow key={incident.id} className="border-slate-100 dark:border-slate-800">
                    <TableCell className="pl-4 font-medium text-slate-900 dark:text-slate-100">
                      {incident.incidentNumber}
                    </TableCell>
                    <TableCell>{incident.residentName}</TableCell>
                    <TableCell>
                      <CategoryBadge category={incident.category} />
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={incident.severity} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={incident.status} />
                    </TableCell>
                    <TableCell>{incident.reportedBy}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{incident.reportedAt}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{incident.followupDue}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Open incident ${incident.incidentNumber}`}>
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

async function fetchIncidentsFromSupabase(selectedFacilityId: string | null): Promise<IncidentRow[]> {
  const supabase = createClient();
  let incidentsQuery = supabase
    .from("incidents" as never)
    .select(
      "id, incident_number, resident_id, facility_id, category, severity, status, occurred_at, reported_by, deleted_at",
    )
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (selectedFacilityId) {
    incidentsQuery = incidentsQuery.eq("facility_id", selectedFacilityId);
  }

  const incidentsResult = (await incidentsQuery) as unknown as QueryResult<SupabaseIncidentRow>;
  const incidents = incidentsResult.data ?? [];
  if (incidentsResult.error) {
    throw incidentsResult.error;
  }
  if (incidents.length === 0) {
    return [];
  }

  const incidentIds = incidents.map((row) => row.id);
  const residentIds = Array.from(
    new Set(
      incidents
        .map((row) => row.resident_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const reporterIds = Array.from(new Set(incidents.map((row) => row.reported_by)));

  const residentsResult = residentIds.length
    ? ((await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .in("id", residentIds)) as unknown as QueryResult<SupabaseResidentMini>)
    : ({ data: [], error: null } as QueryResult<SupabaseResidentMini>);
  if (residentsResult.error) {
    throw residentsResult.error;
  }

  const profilesResult = reporterIds.length
    ? ((await supabase
        .from("user_profiles" as never)
        .select("id, full_name")
        .in("id", reporterIds)) as unknown as QueryResult<SupabaseProfileMini>)
    : ({ data: [], error: null } as QueryResult<SupabaseProfileMini>);
  if (profilesResult.error) {
    throw profilesResult.error;
  }

  const followupsResult = incidentIds.length
    ? ((await supabase
        .from("incident_followups" as never)
        .select("incident_id, due_at")
        .in("incident_id", incidentIds)
        .is("deleted_at", null)
        .is("completed_at", null)) as unknown as QueryResult<SupabaseFollowupMini>)
    : ({ data: [], error: null } as QueryResult<SupabaseFollowupMini>);
  if (followupsResult.error) {
    throw followupsResult.error;
  }

  const residentById = new Map((residentsResult.data ?? []).map((r) => [r.id, r] as const));
  const reporterById = new Map((profilesResult.data ?? []).map((p) => [p.id, p] as const));

  const nextDueByIncident = new Map<string, string>();
  for (const row of followupsResult.data ?? []) {
    const existing = nextDueByIncident.get(row.incident_id);
    if (!existing || new Date(row.due_at).getTime() < new Date(existing).getTime()) {
      nextDueByIncident.set(row.incident_id, row.due_at);
    }
  }

  return incidents.map((row) => {
    const resident = row.resident_id ? residentById.get(row.resident_id) : null;
    const first = resident?.first_name ?? "";
    const last = resident?.last_name ?? "";
    const residentName = `${first} ${last}`.trim() || (row.resident_id ? "Unknown resident" : "Environmental");

    const reporter = reporterById.get(row.reported_by);
    const reportedBy = reporter?.full_name?.trim() || "Staff";

    const dueIso = nextDueByIncident.get(row.id);
    const followupDue = dueIso ? formatFollowupDue(dueIso) : "—";

    return {
      id: row.id,
      incidentNumber: row.incident_number,
      residentName,
      category: mapDbCategoryToUi(row.category),
      severity: mapDbSeverityToUi(row.severity),
      status: mapDbStatusToUi(row.status),
      reportedAt: formatOccurredAt(row.occurred_at),
      reportedBy,
      followupDue,
    } satisfies IncidentRow;
  });
}

function mapDbStatusToUi(value: string): IncidentStatus {
  if (value === "investigating") return "in_review";
  if (value === "resolved" || value === "closed") return "closed";
  return "open";
}

function mapDbSeverityToUi(value: string): IncidentSeverity {
  if (value === "level_2" || value === "level_3" || value === "level_4") {
    return value;
  }
  return "level_1";
}

function mapDbCategoryToUi(value: string): IncidentCategory {
  if (value.startsWith("fall_")) return "fall";
  if (value === "elopement" || value === "wandering") return "elopement";
  if (value.startsWith("medication_")) return "medication_error";
  if (
    value.startsWith("behavioral_") ||
    value === "abuse_allegation" ||
    value === "neglect_allegation"
  ) {
    return "behavioral";
  }
  return "other";
}

function formatOccurredAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatFollowupDue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function CategoryBadge({ category }: { category: IncidentCategory }) {
  const map: Record<IncidentCategory, { label: string; className: string }> = {
    fall: { label: "Fall", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    medication_error: {
      label: "Medication",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    },
    behavioral: {
      label: "Behavioral",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    },
    elopement: {
      label: "Elopement",
      className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    },
    other: { label: "Other", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  };

  return <Badge className={map[category].className}>{map[category].label}</Badge>;
}

function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const map: Record<IncidentSeverity, { label: string; className: string }> = {
    level_1: { label: "L1", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    level_2: { label: "L2", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    level_3: { label: "L3", className: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" },
    level_4: { label: "L4", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  };
  return <Badge className={map[severity].className}>{map[severity].label}</Badge>;
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const map: Record<IncidentStatus, { label: string; className: string }> = {
    open: { label: "Open", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
    in_review: {
      label: "In Review",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    closed: { label: "Closed", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

const mockIncidents: IncidentRow[] = [
  {
    id: "inc-1001",
    incidentNumber: "INC-2026-00142",
    residentName: "Eleanor Vance",
    category: "fall",
    severity: "level_4",
    status: "open",
    reportedAt: "Today, 08:42",
    reportedBy: "Maria G. (CNA)",
    followupDue: "Today, 10:00",
  },
  {
    id: "inc-1002",
    incidentNumber: "INC-2026-00139",
    residentName: "Margaret Sullivan",
    category: "medication_error",
    severity: "level_3",
    status: "in_review",
    reportedAt: "Today, 07:18",
    reportedBy: "John D. (RN)",
    followupDue: "Today, 12:00",
  },
  {
    id: "inc-1003",
    incidentNumber: "INC-2026-00137",
    residentName: "Lucille Booth",
    category: "behavioral",
    severity: "level_2",
    status: "open",
    reportedAt: "Yesterday, 21:31",
    reportedBy: "Theresa W. (Med Tech)",
    followupDue: "Tomorrow, 09:00",
  },
  {
    id: "inc-1004",
    incidentNumber: "INC-2026-00129",
    residentName: "William Hastings",
    category: "other",
    severity: "level_1",
    status: "closed",
    reportedAt: "Mar 27, 14:22",
    reportedBy: "System Import",
    followupDue: "Completed",
  },
];
