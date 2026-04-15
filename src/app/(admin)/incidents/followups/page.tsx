"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, Loader2, UserPlus } from "lucide-react";

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

type FollowupRow = {
  id: string;
  incidentId: string;
  incidentNumber: string;
  residentName: string;
  taskType: string;
  description: string;
  dueAt: string;
  assignedToId: string | null;
  assignee: string;
  unassigned: boolean;
  urgency: "overdue" | "due_24h" | "due_later";
  hoursUntilDue: number;
};

type QueueFilter = "all" | "overdue" | "due_24h" | "unassigned" | "assigned_to_me";

type IncidentMini = { id: string; incident_number: string; resident_id: string | null };
type ResidentMini = { id: string; first_name: string | null; last_name: string | null };
type ProfileMini = { id: string; full_name: string | null };

export default function AdminIncidentFollowupsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("incident_followups")
        .select("id, incident_id, resident_id, facility_id, task_type, description, due_at, assigned_to")
        .is("deleted_at", null)
        .is("completed_at", null)
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
        supabase.from("incidents").select("id, incident_number, resident_id").in("id", incidentIds),
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

      const incidentById = new Map(((incidentsResult.data ?? []) as IncidentMini[]).map((row) => [row.id, row]));
      const residentById = new Map(((residentsResult.data ?? []) as ResidentMini[]).map((row) => [row.id, row]));
      const assigneeById = new Map(((assigneesResult.data ?? []) as ProfileMini[]).map((row) => [row.id, row.full_name?.trim() || "Assigned"]));

      setRows(
        followups.map((row) => {
          const resident = row.resident_id ? residentById.get(row.resident_id) : null;
          const residentName = resident ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || "Resident" : "Resident";
          const hoursUntilDue = Math.ceil((new Date(row.due_at).getTime() - Date.now()) / 3_600_000);
          const urgency: FollowupRow["urgency"] =
            hoursUntilDue < 0 ? "overdue" : hoursUntilDue <= 24 ? "due_24h" : "due_later";
          return {
            id: row.id,
            incidentId: row.incident_id,
            incidentNumber: incidentById.get(row.incident_id)?.incident_number ?? "Incident",
            residentName,
            taskType: row.task_type.replace(/_/g, " "),
            description: row.description,
            dueAt: row.due_at,
            assignedToId: row.assigned_to,
            assignee: row.assigned_to ? assigneeById.get(row.assigned_to) ?? "Assigned" : "Unassigned",
            unassigned: !row.assigned_to,
            urgency,
            hoursUntilDue,
          };
        }),
      );
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load incident follow-ups.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const counts = {
    all: rows.length,
    overdue: rows.filter((row) => row.urgency === "overdue").length,
    due24h: rows.filter((row) => row.urgency === "due_24h").length,
    unassigned: rows.filter((row) => row.unassigned).length,
    assignedToMe: rows.filter((row) => !!user && row.assignedToId === user.id).length,
  };

  const visibleRows = rows.filter((row) => {
    if (queueFilter === "overdue") return row.urgency === "overdue";
    if (queueFilter === "due_24h") return row.urgency === "due_24h";
    if (queueFilter === "unassigned") return row.unassigned;
    if (queueFilter === "assigned_to_me") return !!user && row.assignedToId === user.id;
    return true;
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
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Incident Follow-ups</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Work the full follow-up backlog across incidents, with urgency and ownership filters.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{counts.all} open</Badge>
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">{counts.overdue} overdue</Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{counts.unassigned} unassigned</Badge>
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
          title="No open follow-ups"
          description="The incident follow-up backlog is clear for this scope."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: "all", label: `All (${counts.all})` },
              { key: "overdue", label: `Overdue (${counts.overdue})` },
              { key: "due_24h", label: `Due in 24h (${counts.due24h})` },
              { key: "unassigned", label: `Unassigned (${counts.unassigned})` },
              { key: "assigned_to_me", label: `Assigned to me (${counts.assignedToMe})` },
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

          <div className="grid gap-4">
            {visibleRows.map((row) => (
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
                      {row.urgency === "overdue" ? (
                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                          {Math.abs(row.hoursUntilDue)}h overdue
                        </Badge>
                      ) : row.urgency === "due_24h" ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          Due in {row.hoursUntilDue}h
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                          Due later
                        </Badge>
                      )}
                      {row.unassigned ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          Unassigned
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
                      <div className="mt-1 text-slate-900 dark:text-slate-100">{new Date(row.dueAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Assignee</div>
                      <div className="mt-1 text-slate-900 dark:text-slate-100">{row.assignee}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={actionLoading === row.id} onClick={() => void assignToMe(row.id)}>
                      {actionLoading === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><UserPlus className="mr-2 h-3.5 w-3.5" />Assign to me</>}
                    </Button>
                    <Button type="button" size="sm" disabled={actionLoading === row.id} onClick={() => void markComplete(row.id)}>
                      {actionLoading === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Mark complete</>}
                    </Button>
                    <Link href={`/admin/incidents/${row.incidentId}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
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
