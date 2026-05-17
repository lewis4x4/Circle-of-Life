"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, UserPlus } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
  incidentStatus: string;
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
  status: string;
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
type ScopeFilter = "all" | "active" | "open";

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
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
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
        supabase.from("incidents").select("id, incident_number, resident_id, severity, status").in("id", incidentIds),
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
            incidentStatus: incidentById.get(row.incident_id)?.status ?? "",
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
    const requestedScope = searchParams.get("scope");
    if (requestedScope === "active" || requestedScope === "open") {
      setScopeFilter(requestedScope);
      return;
    }
    setScopeFilter("all");
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

  const scopedRows = rows.filter((row) => {
    const matchesSeverity = severityFilter === "all" || row.incidentSeverity === severityFilter;
    const matchesScope =
      scopeFilter === "all" ||
      (scopeFilter === "active"
        ? row.incidentStatus !== "closed" && row.incidentStatus !== "resolved"
        : row.incidentStatus === "open" || row.incidentStatus === "investigating");
    return matchesSeverity && matchesScope;
  });
  const overdueCount = scopedRows.length;
  const escalatedCount = scopedRows.filter((row) => isFollowupEscalated(row.escalationLevel)).length;
  const unassignedCount = scopedRows.filter((row) => row.unassigned).length;
  const assignedToMeCount = scopedRows.filter((row) => !!user && row.assignedToId === user.id).length;
  const assigneePressure = Array.from(
    scopedRows.reduce((map, row) => {
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
  const visibleRows = scopedRows.filter((row) => {
    const matchesQueueFilter =
      queueFilter === "all"
        ? true
        : queueFilter === "escalated"
          ? isFollowupEscalated(row.escalationLevel)
          : queueFilter === "unassigned"
            ? row.unassigned
            : !!user && row.assignedToId === user.id;
    return matchesQueueFilter;
  });

  const assignAllUnassignedToMe = useCallback(async () => {
    if (!user) return;
    const unassignedIds = visibleRows.filter((row) => row.unassigned).map((row) => row.id);
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
  }, [load, supabase, user, visibleRows]);

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
    <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
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
            <h1 className="text-2xl font-semibold text-foreground">Overdue Follow-ups</h1>
            <p className="text-sm text-muted-foreground">
              Work the overdue incident follow-up backlog from one operational queue.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              {overdueCount} overdue
            </Badge>
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
              {escalatedCount} escalated
            </Badge>
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
              {unassignedCount} unassigned
            </Badge>
            <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
              {assignedToMeCount} assigned to me
            </Badge>
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}
      {actionMessage ? (
        <div className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
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
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Backlog by owner</span>
              {assigneePressure.map((item) => (
                <Badge key={item.label} variant="outline" className="border-border bg-muted text-muted-foreground">
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
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                  queueFilter === option.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
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
          {severityFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                Severity filter: {severityFilter.replace("level_", "L")}
              </Badge>
              {scopeFilter !== "all" ? (
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  Scope: {scopeFilter === "open" ? "open only" : "active only"}
                </Badge>
              ) : null}
              <Link href="/admin/incidents/overdue-followups" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
                Clear queue filters
              </Link>
            </div>
          ) : scopeFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                Scope: {scopeFilter === "open" ? "open only" : "active only"}
              </Badge>
              <Link href="/admin/incidents/overdue-followups" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
                Clear queue filters
              </Link>
            </div>
          ) : null}

          <div className="grid gap-3">
          {visibleRows.length === 0 ? (
            <AdminEmptyState
              title="No follow-ups in this filter"
              description="Try another filter to view the remaining overdue work."
            />
          ) : visibleRows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            >
              <div
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  isFollowupEscalated(row.escalationLevel) && row.escalationLevel === "critical"
                    ? "bg-destructive"
                    : isFollowupEscalated(row.escalationLevel)
                      ? "bg-warning"
                      : "bg-destructive",
                )}
              />
              <div className="flex-1 min-w-0 py-2">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-2">
                  <div>
                    <p className="font-semibold text-foreground">{row.taskType}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {row.incidentNumber} · {row.residentName}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border border-destructive/30">
                      {followupEscalationLabel(row.escalationLevel, row.hoursOverdue)}
                    </Badge>
                    {row.unassigned ? (
                      <Badge variant="outline" className="bg-warning/10 text-warning border border-warning/30">
                        Unassigned
                      </Badge>
                    ) : null}
                    {isFollowupEscalated(row.escalationLevel) ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "bg-warning/10 text-warning border border-warning/30",
                          row.escalationLevel === "critical" && "bg-destructive/10 text-destructive border border-destructive/30",
                        )}
                      >
                        {row.escalationLevel === "critical" ? "Critical escalation" : "Escalation risk"}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <p className="text-sm text-foreground pb-3">{row.description}</p>
                <div className="grid gap-3 text-sm sm:grid-cols-2 pb-3">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Due</div>
                    <div className="mt-1 text-foreground">
                      {new Date(row.dueAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Assignee</div>
                    <div className="mt-1 text-foreground">{row.assignee}</div>
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
                        className="h-9 min-w-[12rem] rounded-md border border-border bg-background px-3 text-sm text-foreground"
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
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
