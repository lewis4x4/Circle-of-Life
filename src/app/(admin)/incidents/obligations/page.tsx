"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, GitBranch, Loader2 } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buildIncidentOpenObligations } from "@/lib/incidents/workflow-obligations";
import { cn } from "@/lib/utils";

type QueueFilter = "all" | "notifications" | "regulatory" | "rca" | "care_plan";
type SeverityFilter = "all" | "level_1" | "level_2" | "level_3" | "level_4";
type ScopeFilter = "all" | "active" | "open";

type IncidentRow = {
  id: string;
  incidentNumber: string;
  residentName: string;
  severity: string;
  status: string;
  occurredAt: string;
  openObligations: string[];
  missingNotificationActions: Array<{
    label: string;
    patch: Record<string, boolean | string>;
    successMessage: string;
  }>;
  missingRegulatoryActions: Array<{
    label: string;
    patch: Record<string, boolean | string>;
    successMessage: string;
  }>;
  rootCausePending: boolean;
  carePlanPending: boolean;
};

type IncidentMini = {
  id: string;
  incident_number: string;
  resident_id: string | null;
  severity: string;
  status: string;
  occurred_at: string;
  nurse_notified: boolean;
  administrator_notified: boolean;
  owner_notified: boolean;
  physician_notified: boolean;
  family_notified: boolean;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  insurance_reportable: boolean;
  insurance_reported: boolean;
  care_plan_updated: boolean;
  resolved_at: string | null;
};

type ResidentMini = { id: string; first_name: string | null; last_name: string | null };
type IncidentRcaMini = { incident_id: string; investigation_status: string };
type FollowupMini = { incident_id: string };

export default function AdminIncidentObligationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let incidentsQuery = supabase
        .from("incidents")
        .select(
          "id, incident_number, resident_id, severity, status, occurred_at, nurse_notified, administrator_notified, owner_notified, physician_notified, family_notified, ahca_reportable, ahca_reported, insurance_reportable, insurance_reported, care_plan_updated, resolved_at",
        )
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(200);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        incidentsQuery = incidentsQuery.eq("facility_id", selectedFacilityId);
      }

      const incidentsResult = await incidentsQuery;
      if (incidentsResult.error) throw incidentsResult.error;
      const incidents = (incidentsResult.data ?? []) as IncidentMini[];

      if (incidents.length === 0) {
        setRows([]);
        return;
      }

      const incidentIds = incidents.map((row) => row.id);
      const residentIds = [...new Set(incidents.map((row) => row.resident_id).filter(Boolean))] as string[];

      const [residentsResult, rcaResult, followupsResult] = await Promise.all([
        residentIds.length > 0
          ? supabase.from("residents").select("id, first_name, last_name").in("id", residentIds)
          : Promise.resolve({ data: [], error: null }),
        incidentIds.length > 0
          ? supabase.from("incident_rca").select("incident_id, investigation_status").in("incident_id", incidentIds)
          : Promise.resolve({ data: [], error: null }),
        incidentIds.length > 0
          ? supabase
              .from("incident_followups")
              .select("incident_id")
              .in("incident_id", incidentIds)
              .is("deleted_at", null)
              .is("completed_at", null)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (residentsResult.error) throw residentsResult.error;
      if (rcaResult.error) throw rcaResult.error;
      if (followupsResult.error) throw followupsResult.error;

      const residentById = new Map(((residentsResult.data ?? []) as ResidentMini[]).map((row) => [row.id, row]));
      const rcaByIncidentId = new Map(
        ((rcaResult.data ?? []) as IncidentRcaMini[]).map((row) => [row.incident_id, row.investigation_status]),
      );
      const openFollowupCountByIncident = new Map<string, number>();
      for (const row of ((followupsResult.data ?? []) as FollowupMini[])) {
        openFollowupCountByIncident.set(row.incident_id, (openFollowupCountByIncident.get(row.incident_id) ?? 0) + 1);
      }

      const workflowRows = incidents
        .map((row) => {
          const resident = row.resident_id ? residentById.get(row.resident_id) : null;
          const residentName = resident
            ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || "Resident"
            : "Resident";
          const openObligations = buildIncidentOpenObligations(row);
          const openFollowups = openFollowupCountByIncident.get(row.id) ?? 0;
          const rootCausePending =
            row.severity === "level_3" || row.severity === "level_4" || openFollowups > 0
              ? rcaByIncidentId.get(row.id) !== "complete"
              : false;
          const carePlanPending =
            Boolean(row.resolved_at) &&
            !row.care_plan_updated &&
            (row.severity === "level_3" || row.severity === "level_4" || openFollowups > 0);

          const missingNotificationActions: IncidentRow["missingNotificationActions"] = [];
          if (!row.nurse_notified) {
            missingNotificationActions.push({
              label: "Mark nurse notified",
              patch: { nurse_notified: true, nurse_notified_at: new Date().toISOString() },
              successMessage: "Nurse notification recorded.",
            });
          }
          if (!row.administrator_notified) {
            missingNotificationActions.push({
              label: "Mark administrator notified",
              patch: { administrator_notified: true, administrator_notified_at: new Date().toISOString() },
              successMessage: "Administrator notification recorded.",
            });
          }
          if ((row.severity === "level_3" || row.severity === "level_4") && !row.owner_notified) {
            missingNotificationActions.push({
              label: "Mark owner notified",
              patch: { owner_notified: true, owner_notified_at: new Date().toISOString() },
              successMessage: "Owner notification recorded.",
            });
          }
          if ((row.severity === "level_3" || row.severity === "level_4") && !row.physician_notified) {
            missingNotificationActions.push({
              label: "Mark physician notified",
              patch: { physician_notified: true, physician_notified_at: new Date().toISOString() },
              successMessage: "Physician notification recorded.",
            });
          }
          if ((row.severity === "level_3" || row.severity === "level_4") && !row.family_notified) {
            missingNotificationActions.push({
              label: "Mark family notified",
              patch: { family_notified: true, family_notified_at: new Date().toISOString() },
              successMessage: "Family notification recorded.",
            });
          }

          const missingRegulatoryActions: IncidentRow["missingRegulatoryActions"] = [];
          if (row.ahca_reportable && !row.ahca_reported) {
            missingRegulatoryActions.push({
              label: "Mark AHCA reported",
              patch: { ahca_reported: true, ahca_reported_at: new Date().toISOString() },
              successMessage: "AHCA reporting recorded.",
            });
          }
          if (row.insurance_reportable && !row.insurance_reported) {
            missingRegulatoryActions.push({
              label: "Mark insurance reported",
              patch: { insurance_reported: true, insurance_reported_at: new Date().toISOString() },
              successMessage: "Insurance reporting recorded.",
            });
          }

          return {
            id: row.id,
            incidentNumber: row.incident_number,
            residentName,
            severity: row.severity,
            status: row.status,
            occurredAt: row.occurred_at,
            openObligations,
            missingNotificationActions,
            missingRegulatoryActions,
            rootCausePending,
            carePlanPending,
          } satisfies IncidentRow;
        })
        .filter(
          (row) =>
            row.openObligations.length > 0 || row.rootCausePending || row.carePlanPending,
        );

      setRows(workflowRows);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load incident workflow obligations.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requestedSeverity = searchParams.get("severity");
    if (
      requestedSeverity === "level_1" ||
      requestedSeverity === "level_2" ||
      requestedSeverity === "level_3" ||
      requestedSeverity === "level_4"
    ) {
      setSeverityFilter(requestedSeverity);
      return;
    }
    setSeverityFilter("all");
  }, [searchParams]);

  useEffect(() => {
    const requestedScope = searchParams.get("scope");
    if (requestedScope === "active" || requestedScope === "open") {
      setScopeFilter(requestedScope);
      return;
    }
    setScopeFilter("all");
  }, [searchParams]);

  const updateIncident = useCallback(
    async (incidentId: string, patch: Record<string, boolean | string>, successMessage: string) => {
      setActionLoading(`${incidentId}:${successMessage}`);
      setActionError(null);
      setActionMessage(null);
      try {
        const { error: updateError } = await supabase
          .from("incidents")
          .update({
            ...patch,
            updated_at: new Date().toISOString(),
          })
          .eq("id", incidentId);
        if (updateError) throw updateError;
        setActionMessage(successMessage);
        await load();
      } catch (incidentError) {
        setActionError(incidentError instanceof Error ? incidentError.message : "Could not update incident workflow.");
      } finally {
        setActionLoading(null);
      }
    },
    [load, supabase],
  );

  const scopedRows = rows.filter((row) => {
    const matchesSeverity = severityFilter === "all" || row.severity === severityFilter;
    const matchesScope =
      scopeFilter === "all" ||
      (scopeFilter === "active"
        ? row.status !== "closed" && row.status !== "resolved"
        : row.status === "open" || row.status === "investigating");
    return matchesSeverity && matchesScope;
  });

  const counts = {
    all: scopedRows.length,
    notifications: scopedRows.filter((row) => row.missingNotificationActions.length > 0).length,
    regulatory: scopedRows.filter((row) => row.missingRegulatoryActions.length > 0).length,
    rca: scopedRows.filter((row) => row.rootCausePending).length,
    carePlan: scopedRows.filter((row) => row.carePlanPending).length,
  };

  const visibleRows = scopedRows.filter((row) => {
    const matchesQueueFilter =
      queueFilter === "notifications"
        ? row.missingNotificationActions.length > 0
        : queueFilter === "regulatory"
          ? row.missingRegulatoryActions.length > 0
          : queueFilter === "rca"
            ? row.rootCausePending
            : queueFilter === "care_plan"
              ? row.carePlanPending
              : true;
    return matchesQueueFilter;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Link href="/admin/incidents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Incident queue
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Incident Lifecycle Blockers</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Work notification, reporting, RCA, and care-plan blockers without drilling into every incident first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{counts.all} active</Badge>
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{counts.notifications} notifications</Badge>
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">{counts.regulatory} reporting</Badge>
            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{counts.rca} RCA</Badge>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{counts.carePlan} care plan</Badge>
          </div>
        </div>
      </div>

      {actionError ? <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">{actionError}</div> : null}
      {actionMessage ? <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">{actionMessage}</div> : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No incident lifecycle blockers"
          description="Notification, reporting, RCA, and care-plan obligations are clear for this scope."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "all", label: `All (${counts.all})` },
              { key: "notifications", label: `Notifications (${counts.notifications})` },
              { key: "regulatory", label: `Reporting (${counts.regulatory})` },
              { key: "rca", label: `RCA (${counts.rca})` },
              { key: "care_plan", label: `Care plan (${counts.carePlan})` },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setQueueFilter(option.key as QueueFilter)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  queueFilter === option.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {severityFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                Severity filter: {severityFilter.replace("level_", "L")}
              </Badge>
              {scopeFilter !== "all" ? (
                <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  Scope: {scopeFilter === "open" ? "open only" : "active only"}
                </Badge>
              ) : null}
              <Link href="/admin/incidents/obligations" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
                Clear filters
              </Link>
            </div>
          ) : scopeFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                Scope: {scopeFilter === "open" ? "open only" : "active only"}
              </Badge>
              <Link href="/admin/incidents/obligations" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
                Clear filters
              </Link>
            </div>
          ) : null}

          <div className="grid gap-4">
            {visibleRows.map((row) => (
              <Card key={row.id} className="border-slate-200/70 shadow-soft dark:border-slate-800">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {row.incidentNumber}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {row.residentName} · {formatOccurredAt(row.occurredAt)}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                        {row.severity.replace("level_", "L")}
                      </Badge>
                      {row.missingNotificationActions.length > 0 ? (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                          {row.missingNotificationActions.length} notify
                        </Badge>
                      ) : null}
                      {row.missingRegulatoryActions.length > 0 ? (
                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                          {row.missingRegulatoryActions.length} reporting
                        </Badge>
                      ) : null}
                      {row.rootCausePending ? (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                          RCA pending
                        </Badge>
                      ) : null}
                      {row.carePlanPending ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          Care plan pending
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {row.openObligations.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Open obligations</p>
                      <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                        {row.openObligations.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {row.missingNotificationActions.map((action) => (
                      <Button
                        key={action.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionLoading === `${row.id}:${action.successMessage}`}
                        onClick={() => void updateIncident(row.id, action.patch, action.successMessage)}
                      >
                        {actionLoading === `${row.id}:${action.successMessage}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.label}
                      </Button>
                    ))}
                    {row.missingRegulatoryActions.map((action) => (
                      <Button
                        key={action.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionLoading === `${row.id}:${action.successMessage}`}
                        onClick={() => void updateIncident(row.id, action.patch, action.successMessage)}
                      >
                        {actionLoading === `${row.id}:${action.successMessage}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.label}
                      </Button>
                    ))}
                    {row.carePlanPending ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={actionLoading === `${row.id}:Care plan update recorded.`}
                        onClick={() =>
                          void updateIncident(
                            row.id,
                            { care_plan_updated: true },
                            "Care plan update recorded.",
                          )
                        }
                      >
                        {actionLoading === `${row.id}:Care plan update recorded.` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                            Mark care plan updated
                          </>
                        )}
                      </Button>
                    ) : null}
                    {row.rootCausePending ? (
                      <Link href={`/admin/incidents/${row.id}/rca`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        <GitBranch className="mr-2 h-3.5 w-3.5" />
                        Open RCA
                      </Link>
                    ) : null}
                    <Link href={`/admin/incidents/${row.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                      <ClipboardList className="mr-2 h-3.5 w-3.5" />
                      Incident detail
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatOccurredAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}
