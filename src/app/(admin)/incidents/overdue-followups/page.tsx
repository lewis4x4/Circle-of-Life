"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, UserPlus } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  fetchIncidentFollowupAssignees,
  type IncidentFollowupAssigneeOption,
} from "@/lib/incidents/followup-assignees";
import {
  classifyFollowupEscalation,
  followupEscalationLabel,
  isFollowupEscalated,
  type FollowupEscalationLevel,
} from "@/lib/incidents/followup-escalation";

type FollowupRow = {
  id: string;
  incidentId: string;
  incidentNumber: string;
  incidentSeverity: string;
  residentName: string;
  taskType: string;
  description: string;
  dueAt: string;
  assignedToId: string | null;
  assignee: string;
  unassigned: boolean;
  hoursOverdue: number;
  escalationLevel: FollowupEscalationLevel;
};

type IncidentMini = {
  id: string;
  incident_number: string;
  resident_id: string | null;
  severity: string;
};

type ResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type ProfileMini = {
  id: string;
  full_name: string | null;
};

type QueueFilter = "all" | "escalated" | "unassigned" | "assigned_to_me";
type SeverityFilter = "all" | "level_1" | "level_2" | "level_3" | "level_4";

export default function AdminIncidentOverdueFollowupsPage() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const { user } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [assigneeOptions, setAssigneeOptions] = useState<IncidentFollowupAssigneeOption[]>([]);
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("incident_followups")
        .select("id, incident_id, resident_id, facility_id, task_type, description, due_at, assigned_to")
        .is("deleted_at", null)
        .is("completed_at", null)
        .lt("due_at", new Date().toISOString())
        .order("due_at", { ascending: true });

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        query = query.eq("facility_id", selectedFacilityId);
      }

      const { data, error: followupError } = await query;
      if (followupError) throw followupError;
      const followups = (data ?? []) as Array<{
        id: string;
        incident_id: string;
        resident_id: string | null;
        facility_id: string;
        task_type: string;
        description: string;
        due_at: string;
        assigned_to: string | null;
      }>;

      if (followups.length === 0) {
        setRows([]);
        return;
      }

      const incidentIds = [...new Set(followups.map((row) => row.incident_id))];
      const residentIds = [...new Set(followups.map((row) => row.resident_id).filter(Boolean))] as string[];
      const assigneeIds = [...new Set(followups.map((row) => row.assigned_to).filter(Boolean))] as string[];

      const [incidentsResult, residentsResult, assigneesResult] = await Promise.all([
        supabase.from("incidents").select("id, incident_number, resident_id, severity").in("id", incidentIds),
        residentIds.length > 0
          ? supabase.from("residents").select("id, first_name, last_name").in("id", residentIds)
          : Promise.resolve({ data: [], error: null }),
        assigneeIds.length > 0
          ? supabase.from("user_profiles").select("id, full_name").in("id", assigneeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (incidentsResult.error) throw incidentsResult.error;
      if (residentsResult.error) throw residentsResult.error;
      if (assigneesResult.error) throw assigneesResult.error;

      const incidentById = new Map(
        ((incidentsResult.data ?? []) as IncidentMini[]).map((row) => [row.id, row]),
      );
      const residentById = new Map(
        ((residentsResult.data ?? []) as ResidentMini[]).map((row) => [row.id, row]),
      );
      const assigneeById = new Map(
        ((assigneesResult.data ?? []) as ProfileMini[]).map((row) => [row.id, row.full_name?.trim() || "Assigned"]),
      );

      setRows(
        followups.map((row) => {
          const resident = row.resident_id ? residentById.get(row.resident_id) : null;
          const residentName = resident
            ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || "Resident"
            : "Resident";
          const dueMs = new Date(row.due_at).getTime();
          return {
            id: row.id,
            incidentId: row.incident_id,
            incidentNumber: incidentById.get(row.incident_id)?.incident_number ?? "Incident",
            incidentSeverity: incidentById.get(row.incident_id)?.severity ?? "level_1",
            residentName,
            taskType: row.task_type.replace(/_/g, " "),
            description: row.description,
            dueAt: row.due_at,
            assignedToId: row.assigned_to,
            assignee: row.assigned_to ? assigneeById.get(row.assigned_to) ?? "Assigned" : "Unassigned",
            unassigned: !row.assigned_to,
            hoursOverdue: Math.max(1, Math.ceil((Date.now() - dueMs) / 3_600_000)),
            escalationLevel: classifyFollowupEscalation(Math.max(1, Math.ceil((Date.now() - dueMs) / 3_600_000))),
          };
        }),
      );
      setAssigneeDrafts(
        Object.fromEntries(followups.map((row) => [row.id, row.assigned_to ?? ""])),
      );
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load overdue follow-ups.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requestedFilter = searchParams.get("filter");
    if (
      requestedFilter === "escalated" ||
      requestedFilter === "unassigned" ||
      requestedFilter === "assigned_to_me"
    ) {
      setQueueFilter(requestedFilter);
      return;
    }
    setQueueFilter("all");
  }, [searchParams]);

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
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setAssigneeOptions([]);
      return;
    }
    let cancelled = false;
    void fetchIncidentFollowupAssignees(selectedFacilityId)
      .then((options) => {
        if (!cancelled) {
          setAssigneeOptions(options);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAssigneeOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFacilityId]);

  const assignToMe = useCallback(async (followupId: string) => {
    if (!user) return;
    setActionLoading(followupId);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({ assigned_to: user.id, updated_at: new Date().toISOString() })
        .eq("id", followupId);
      if (updateError) throw updateError;
      setActionMessage("Follow-up assigned to you.");
      await load();
    } catch (assignError) {
      setActionError(assignError instanceof Error ? assignError.message : "Could not assign follow-up.");
    } finally {
      setActionLoading(null);
    }
  }, [load, supabase, user]);

  const markComplete = useCallback(async (followupId: string) => {
    if (!user) return;
    setActionLoading(followupId);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({
          completed_at: new Date().toISOString(),
          completed_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", followupId);
      if (updateError) throw updateError;
      setActionMessage("Follow-up marked complete.");
      await load();
    } catch (completeError) {
      setActionError(completeError instanceof Error ? completeError.message : "Could not complete follow-up.");
    } finally {
      setActionLoading(null);
    }
  }, [load, supabase, user]);

  const saveAssignee = useCallback(async (followupId: string) => {
    setActionLoading(followupId);
    setActionError(null);
    setActionMessage(null);
    try {
      const assigneeId = assigneeDrafts[followupId] || null;
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
        .eq("id", followupId);
      if (updateError) throw updateError;
      setActionMessage(assigneeId ? "Follow-up assignee saved." : "Follow-up assignee cleared.");
      await load();
    } catch (assignError) {
      setActionError(assignError instanceof Error ? assignError.message : "Could not save assignee.");
    } finally {
      setActionLoading(null);
    }
  }, [assigneeDrafts, load, supabase]);

  const overdueCount = rows.length;
  const escalatedCount = rows.filter((row) => isFollowupEscalated(row.escalationLevel)).length;
  const unassignedCount = rows.filter((row) => row.unassigned).length;
  const assignedToMeCount = rows.filter((row) => !!user && row.assignedToId === user.id).length;
  const assigneePressure = Array.from(
    rows.reduce((map, row) => {
      const key = row.assignedToId ?? "unassigned";
      const current = map.get(key) ?? {
        label: row.unassigned ? "Unassigned" : row.assignee,
        count: 0,
      };
      current.count += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { label: string; count: number }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  const visibleRows = rows.filter((row) => {
    const matchesSeverity = severityFilter === "all" || row.incidentSeverity === severityFilter;
    const matchesQueueFilter =
      queueFilter === "all"
        ? true
        : queueFilter === "escalated"
          ? isFollowupEscalated(row.escalationLevel)
          : queueFilter === "unassigned"
            ? row.unassigned
            : !!user && row.assignedToId === user.id;
    return matchesSeverity && matchesQueueFilter;
  });

  const assignAllUnassignedToMe = useCallback(async () => {
    if (!user) return;
    const unassignedIds = rows.filter((row) => row.unassigned).map((row) => row.id);
    if (unassignedIds.length === 0) return;
    setActionLoading("bulk-assign");
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({ assigned_to: user.id, updated_at: new Date().toISOString() })
        .in("id", unassignedIds);
      if (updateError) throw updateError;
      setActionMessage(`Assigned ${unassignedIds.length} overdue follow-up${unassignedIds.length === 1 ? "" : "s"} to you.`);
      await load();
    } catch (assignError) {
      setActionError(assignError instanceof Error ? assignError.message : "Could not bulk-assign overdue follow-ups.");
    } finally {
      setActionLoading(null);
    }
  }, [load, rows, supabase, user]);

  const completeAllAssignedToMe = useCallback(async () => {
    if (!user) return;
    const myIds = rows.filter((row) => row.assignedToId === user.id).map((row) => row.id);
    if (myIds.length === 0) return;
    setActionLoading("bulk-complete");
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({
          completed_at: new Date().toISOString(),
          completed_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .in("id", myIds);
      if (updateError) throw updateError;
      setActionMessage(`Marked ${myIds.length} overdue follow-up${myIds.length === 1 ? "" : "s"} complete.`);
      await load();
    } catch (completeError) {
      setActionError(completeError instanceof Error ? completeError.message : "Could not bulk-complete follow-ups.");
    } finally {
      setActionLoading(null);
    }
  }, [load, rows, supabase, user]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Link
          href="/admin/incidents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Incident queue
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/admin/incidents/followups" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Open all follow-ups
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Overdue Follow-ups</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Work the overdue incident follow-up backlog from one operational queue.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              {overdueCount} overdue
            </Badge>
            <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
              {escalatedCount} escalated
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              {unassignedCount} unassigned
            </Badge>
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {assignedToMeCount} assigned to me
            </Badge>
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {actionError}
        </div>
      ) : null}
      {actionMessage ? (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          {actionMessage}
        </div>
      ) : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No overdue follow-ups"
          description="The current incident follow-up backlog is clear for this scope."
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Backlog by owner</span>
              {assigneePressure.map((item) => (
                <Badge key={item.label} variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  {item.label}: {item.count}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "all", label: "All overdue" },
              { key: "escalated", label: `Escalated (${escalatedCount})` },
              { key: "unassigned", label: "Unassigned only" },
              { key: "assigned_to_me", label: "Assigned to me" },
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionLoading === "bulk-assign" || unassignedCount === 0}
              onClick={() => void assignAllUnassignedToMe()}
            >
              {actionLoading === "bulk-assign" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><UserPlus className="mr-2 h-3.5 w-3.5" />Assign all unassigned to me</>}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={actionLoading === "bulk-complete" || assignedToMeCount === 0}
              onClick={() => void completeAllAssignedToMe()}
            >
              {actionLoading === "bulk-complete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Complete all assigned to me</>}
            </Button>
          </div>

          <div className="grid gap-4">
          {visibleRows.length === 0 ? (
            <AdminEmptyState
              title="No follow-ups in this filter"
              description="Try another filter to view the remaining overdue work."
            />
          ) : visibleRows.map((row) => (
            <Card key={row.id} className="border-slate-200/70 shadow-soft dark:border-slate-800">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {row.taskType}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {row.incidentNumber} · {row.residentName}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                      {followupEscalationLabel(row.escalationLevel, row.hoursOverdue)}
                    </Badge>
                    {row.unassigned ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        Unassigned
                      </Badge>
                    ) : null}
                    {isFollowupEscalated(row.escalationLevel) ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-orange-200 bg-orange-50 text-orange-700",
                          row.escalationLevel === "critical" && "border-rose-200 bg-rose-50 text-rose-700",
                        )}
                      >
                        {row.escalationLevel === "critical" ? "Critical escalation" : "Escalation risk"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-700 dark:text-slate-300">{row.description}</p>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Due</div>
                    <div className="mt-1 text-slate-900 dark:text-slate-100">
                      {new Date(row.dueAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Assignee</div>
                    <div className="mt-1 text-slate-900 dark:text-slate-100">{row.assignee}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={actionLoading === row.id}
                    onClick={() => void assignToMe(row.id)}
                  >
                    {actionLoading === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><UserPlus className="mr-2 h-3.5 w-3.5" />Assign to me</>}
                  </Button>
                  {assigneeOptions.length > 0 ? (
                    <>
                      <select
                        value={assigneeDrafts[row.id] ?? ""}
                        onChange={(event) =>
                          setAssigneeDrafts((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        className="h-9 min-w-[12rem] rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">Unassigned</option>
                        {assigneeOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionLoading === row.id || (assigneeDrafts[row.id] ?? "") === (row.assignedToId ?? "")}
                        onClick={() => void saveAssignee(row.id)}
                      >
                        {actionLoading === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save assignee"}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={actionLoading === row.id}
                    onClick={() => void markComplete(row.id)}
                  >
                    {actionLoading === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Mark complete</>}
                  </Button>
                  <Link
                    href={`/admin/incidents/${row.incidentId}`}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                  >
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
