"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Loader2, ShieldAlert, XCircle } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { V2Card } from "@/components/ui/v2-card";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type FollowUpStatus = "open" | "in_progress" | "resolved" | "dismissed";

type EscalationRow = {
  id: string;
  resident_id: string;
  task_id: string;
  escalation_level: number;
  escalation_type: string;
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  status: FollowUpStatus;
  residents?: { first_name: string; last_name: string; preferred_name: string | null } | null;
  resident_observation_tasks?: { status: string; due_at: string; grace_ends_at: string; notes: string | null; watch_instance_id: string | null } | null;
  watchSummary?: {
    protocolName: string | null;
    watchStatus: string;
    triggeredByType: string;
    incidentId: string | null;
    incidentNumber: string | null;
    incidentCategory: string | null;
  };
};

const STATUS_STYLES: Record<FollowUpStatus, string> = {
  open: "border-destructive/30 bg-destructive/10 text-destructive",
  in_progress: "border-warning/30 bg-warning/10 text-warning",
  resolved: "border-success/30 bg-success/10 text-success",
  dismissed: "border-border bg-muted text-muted-foreground",
};

function residentName(row: EscalationRow["residents"], fallback: string) {
  if (!row) return fallback;
  return row.preferred_name?.trim() || `${row.first_name} ${row.last_name}`;
}

function relTime(ts: string) {
  const deltaMinutes = Math.round((new Date(ts).getTime() - Date.now()) / 60000);
  if (Math.abs(deltaMinutes) < 60) return `${Math.abs(deltaMinutes)} min ${deltaMinutes >= 0 ? "from now" : "ago"}`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 48) return `${Math.abs(deltaHours)} hr ${deltaHours >= 0 ? "from now" : "ago"}`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? "" : "s"} ${deltaDays >= 0 ? "from now" : "ago"}`;
}

export default function RoundingEscalationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<EscalationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | FollowUpStatus>("all");

  const load = useCallback(async () => {
    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("resident_observation_escalations")
        .select(`
          id,
          resident_id,
          task_id,
          escalation_level,
          escalation_type,
          triggered_at,
          acknowledged_at,
          resolved_at,
          resolution_note,
          status,
          residents(first_name, last_name, preferred_name),
          resident_observation_tasks(status, due_at, grace_ends_at, notes, watch_instance_id)
        `)
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("triggered_at", { ascending: false })
        .limit(100);

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      const escalationRows = (data ?? []) as unknown as EscalationRow[];

      const watchIds = Array.from(
        new Set(
          escalationRows
            .map((row) => row.resident_observation_tasks?.watch_instance_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      );

      if (watchIds.length === 0) {
        setRows(escalationRows);
        return;
      }

      const { data: watchRows, error: watchError } = await supabase
        .from("resident_watch_instances")
        .select("id, status, triggered_by_type, triggered_by_id, resident_watch_protocols(name)")
        .in("id", watchIds)
        .is("deleted_at", null);

      if (watchError) throw watchError;

      const watchMap = new Map(
        ((watchRows ?? []) as Array<{
          id: string;
          status: string;
          triggered_by_type: string;
          triggered_by_id: string | null;
          resident_watch_protocols?: { name: string } | null;
        }>).map((row) => [row.id, row]),
      );

      const incidentIds = Array.from(
        new Set(
          Array.from(watchMap.values())
            .filter((row) => row.triggered_by_type.startsWith("incident_") && row.triggered_by_id)
            .map((row) => row.triggered_by_id as string),
        ),
      );

      const incidentMap = new Map<string, { incident_number: string; category: string }>();
      if (incidentIds.length > 0) {
        const { data: incidents, error: incidentError } = await supabase
          .from("incidents")
          .select("id, incident_number, category")
          .in("id", incidentIds)
          .is("deleted_at", null);
        if (incidentError) throw incidentError;
        for (const incident of (incidents ?? []) as Array<{ id: string; incident_number: string; category: string }>) {
          incidentMap.set(incident.id, {
            incident_number: incident.incident_number,
            category: incident.category,
          });
        }
      }

      const enriched = escalationRows.map((row) => {
        const watchId = row.resident_observation_tasks?.watch_instance_id;
        if (!watchId) return row;
        const watch = watchMap.get(watchId);
        if (!watch) return row;
        const incident = watch.triggered_by_id ? incidentMap.get(watch.triggered_by_id) : undefined;
        return {
          ...row,
          watchSummary: {
            protocolName: watch.resident_watch_protocols?.name ?? null,
            watchStatus: watch.status,
            triggeredByType: watch.triggered_by_type,
            incidentId: watch.triggered_by_type.startsWith("incident_") ? watch.triggered_by_id : null,
            incidentNumber: incident?.incident_number ?? null,
            incidentCategory: incident?.category ?? null,
          },
        };
      });

      setRows(enriched);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load escalations");
    } finally {
      setLoading(false);
    }
  }, [filter, selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => ({
    open: rows.filter((row) => row.status === "open").length,
    in_progress: rows.filter((row) => row.status === "in_progress").length,
    resolved: rows.filter((row) => row.status === "resolved").length,
    dismissed: rows.filter((row) => row.status === "dismissed").length,
  }), [rows]);

  const runAction = useCallback(async (id: string, action: "start_review" | "resolve" | "dismiss") => {
    setActionLoading(`${id}:${action}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/rounding/escalations/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          note: notes[id]?.trim() || undefined,
        }),
      });

      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not update escalation");
      }

      setActionMessage(
        action === "start_review"
          ? "Escalation moved into review."
          : action === "resolve"
            ? "Escalation resolved."
            : "Escalation dismissed.",
      );
      setNotes((current) => ({ ...current, [id]: "" }));
      await load();
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : "Could not update escalation");
    } finally {
      setActionLoading(null);
    }
  }, [load, notes]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-sm mt-4">
          <div className="space-y-2">
            
            <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Observation Escalations
              {counts.open > 0 ? <ShieldAlert className="h-8 w-8 text-destructive" /> : null}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-3xl">
              Review critically overdue and missed observation work before it becomes a resident-safety blind spot.
            </p>
          </div>
          <div>
            <RoundingHubNav />
          </div>
        </div>

        {!selectedFacilityId ? (
          <div className="rounded-[var(--radius)] border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            Select a facility in the admin header to open the escalation queue.
          </div>
        ) : null}

        {actionMessage ? <Banner tone="success">{actionMessage}</Banner> : null}
        {actionError ? <Banner tone="error">{actionError}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Open" value={String(counts.open)} accent="text-destructive" icon={<AlertTriangle className="h-5 w-5" />} pulse={counts.open > 0} />
          <MetricCard label="In Progress" value={String(counts.in_progress)} accent="text-warning" icon={<Clock3 className="h-5 w-5" />} />
          <MetricCard label="Resolved" value={String(counts.resolved)} accent="text-success" icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricCard label="Dismissed" value={String(counts.dismissed)} accent="text-muted-foreground" icon={<XCircle className="h-5 w-5" />} />
        </div>

        <V2Card hoverColor="rose" className="p-6 border-rose-500/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Supervisor escalation lane</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Open, triage, and close resident-observation escalations with preserved task evidence.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["all", "open", "in_progress", "resolved", "dismissed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition",
                    filter === value
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-border bg-card text-muted-foreground hover:border-border/80 hover:bg-muted/40",
                  )}
                >
                  {value === "all" ? "All" : value.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-destructive" />
            </div>
          ) : rows.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No observation escalations match this filter.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {rows.map((row) => {
                const key = (action: string) => `${row.id}:${action}`;
                const task = row.resident_observation_tasks;
                return (
                  <div key={row.id} className="min-h-[36px] px-[13px] py-4 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", STATUS_STYLES[row.status])}>
                            {row.status.replace("_", " ")}
                          </span>
                            <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Level {row.escalation_level}
                          </span>
                          <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {row.escalation_type.replace(/_/g, " ")}
                          </span>
                          {row.watchSummary?.protocolName ? (
                            <span className="rounded-full border border-info/20 bg-info/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-info">
                              {row.watchSummary.protocolName}
                            </span>
                          ) : null}
                        </div>

                        <div>
                          <h3 className="text-xl tracking-tight text-foreground">
                            {residentName(row.residents, row.resident_id.slice(0, 8))}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Triggered {new Date(row.triggered_at).toLocaleString()} · {relTime(row.triggered_at)}
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 text-sm text-muted-foreground">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Task status</p>
                            <p>{task?.status?.replace(/_/g, " ") ?? "Unavailable"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due window</p>
                            <p>
                              {task ? `${new Date(task.due_at).toLocaleString()} -> ${new Date(task.grace_ends_at).toLocaleString()}` : "Unavailable"}
                            </p>
                          </div>
                          {row.watchSummary ? (
                            <>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Watch source</p>
                                <p>{row.watchSummary.triggeredByType.replace(/_/g, " ")}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Watch status</p>
                                <p>{row.watchSummary.watchStatus.replace(/_/g, " ")}</p>
                              </div>
                            </>
                          ) : null}
                        </div>

                        {row.watchSummary?.incidentId ? (
                          <div className="rounded-[var(--radius)] border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-foreground">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Related incident</p>
                                <p>
                                  {row.watchSummary.incidentNumber ?? row.watchSummary.incidentId}
                                  {row.watchSummary.incidentCategory ? ` · ${row.watchSummary.incidentCategory.replace(/_/g, " ")}` : ""}
                                </p>
                              </div>
                              <Link
                                href={`/admin/incidents/${row.watchSummary.incidentId}`}
                                className="text-xs font-bold uppercase tracking-wider text-destructive hover:underline"
                              >
                                Open incident
                              </Link>
                            </div>
                          </div>
                        ) : null}

                        {task?.notes ? (
                          <div className="rounded-[var(--radius)] border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
                            {task.notes}
                          </div>
                        ) : null}

                        {row.resolution_note ? (
                          <div className="rounded-[var(--radius)] border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
                            {row.resolution_note}
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-[260px] space-y-3">
                        <textarea
                          value={notes[row.id] ?? ""}
                          onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                          rows={3}
                          placeholder="Review note or resolution context..."
                          className="w-full rounded-[var(--radius)] border border-border bg-card px-3.5 py-2.5 text-sm text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />

                        <div className="flex flex-wrap gap-2">
                          {row.status === "open" ? (
                            <Button
                              type="button"
                              onClick={() => void runAction(row.id, "start_review")}
                              disabled={actionLoading === key("start_review")}
                              className="rounded-full bg-warning text-primary-foreground hover:bg-warning/90"
                            >
                              {actionLoading === key("start_review") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                              Start review
                            </Button>
                          ) : null}

                          {row.status === "open" || row.status === "in_progress" ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void runAction(row.id, "resolve")}
                                disabled={actionLoading === key("resolve")}
                                className="rounded-full"
                              >
                                {actionLoading === key("resolve") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Resolve
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void runAction(row.id, "dismiss")}
                                disabled={actionLoading === key("dismiss")}
                                className="rounded-full"
                              >
                                {actionLoading === key("dismiss") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                Dismiss
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </V2Card>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  icon,
  pulse = false,
}: {
  label: string;
  value: string;
  accent: string;
  icon: ReactNode;
  pulse?: boolean;
}) {
  return (
    <V2Card hoverColor="rose" className="p-5 border-border">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className={cn("flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider", accent)}>
          {icon}
          {label}
          {pulse ? <span className="ml-auto h-2 w-2 rounded-full bg-destructive" /> : null}
        </div>
        <div className={cn("text-4xl tracking-tight", accent)}>{value}</div>
      </div>
    </V2Card>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border px-4 py-3 text-sm",
        tone === "success"
          ? "border-success/20 bg-success/10 text-success"
          : "border-destructive/20 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </div>
  );
}
