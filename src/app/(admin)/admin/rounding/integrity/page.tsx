"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, Loader2, ShieldAlert, UserSearch, XCircle } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchIncidentFollowupAssignees, type IncidentFollowupAssigneeOption } from "@/lib/incidents/followup-assignees";
import { cn } from "@/lib/utils";

type FollowUpStatus = "open" | "in_progress" | "resolved" | "dismissed";
type Severity = "low" | "medium" | "high" | "critical";

type IntegrityRow = {
  id: string;
  resident_id: string | null;
  staff_id: string | null;
  log_id: string | null;
  assigned_to_staff_id: string | null;
  assigned_at: string | null;
  flag_type: string;
  severity: Severity;
  detected_at: string;
  status: FollowUpStatus;
  disposition_note: string | null;
  residents?: { first_name: string; last_name: string; preferred_name: string | null } | null;
  staff?: { first_name: string; last_name: string; preferred_name: string | null } | null;
  assigned_staff?: { first_name: string; last_name: string; preferred_name: string | null } | null;
  resident_observation_logs?: { quick_status: string; entry_mode: string; observed_at: string; entered_at: string; late_reason: string | null; note: string | null } | null;
};

type IntegrityHistoryItem = {
  id: string;
  action: string;
  changedFields: string[];
  actorName: string;
  createdAt: string;
};

const STATUS_STYLES: Record<FollowUpStatus, string> = {
  open: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  in_progress: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  dismissed: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

const SEVERITY_STYLES: Record<Severity, string> = {
  low: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-200",
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

function personName(
  row: { first_name: string; last_name: string; preferred_name: string | null } | null | undefined,
  fallback: string,
) {
  if (!row) return fallback;
  return row.preferred_name?.trim() || `${row.first_name} ${row.last_name}`;
}

export default function RoundingIntegrityPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<IntegrityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});
  const [assigneeOptions, setAssigneeOptions] = useState<IncidentFollowupAssigneeOption[]>([]);
  const [historyById, setHistoryById] = useState<Record<string, IntegrityHistoryItem[]>>({});
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
        .from("resident_observation_integrity_flags" as never)
        .select(`
          id,
          resident_id,
          staff_id,
          log_id,
          assigned_to_staff_id,
          assigned_at,
          flag_type,
          severity,
          detected_at,
          status,
          disposition_note,
          residents(first_name, last_name, preferred_name),
          staff(first_name, last_name, preferred_name),
          assigned_staff:assigned_to_staff_id(first_name, last_name, preferred_name),
          resident_observation_logs(quick_status, entry_mode, observed_at, entered_at, late_reason, note)
        `)
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("detected_at", { ascending: false })
        .limit(100);

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      const nextRows = (data ?? []) as unknown as IntegrityRow[];
      setRows(nextRows);
      setAssigneeDrafts(
        Object.fromEntries(nextRows.map((row) => [row.id, row.assigned_to_staff_id ?? ""])),
      );

      try {
        const options = await fetchIncidentFollowupAssignees(selectedFacilityId);
        setAssigneeOptions(options);
      } catch {
        setAssigneeOptions([]);
      }

      if (nextRows.length > 0) {
        const ids = nextRows.map((row) => row.id).join(",");
        const response = await fetch(
          `/api/rounding/integrity-flags/history?facilityId=${encodeURIComponent(selectedFacilityId)}&ids=${encodeURIComponent(ids)}`,
          { method: "GET", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; historyById?: Record<string, IntegrityHistoryItem[]>; error?: string }
          | null;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Could not load integrity history.");
        }
        setHistoryById(payload.historyById ?? {});
      } else {
        setHistoryById({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load integrity flags");
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
    critical: rows.filter((row) => row.severity === "critical").length,
  }), [rows]);

  const runAction = useCallback(async (id: string, action: "assign" | "start_review" | "resolve" | "dismiss") => {
    setActionLoading(`${id}:${action}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/rounding/integrity-flags/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          note: notes[id]?.trim() || undefined,
          assignedStaffId: action === "assign" ? (assigneeDrafts[id] || null) : undefined,
        }),
      });

      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not update integrity flag");
      }

      setActionMessage(
        action === "assign"
          ? "Integrity flag assignment saved."
          : action === "start_review"
          ? "Integrity flag moved into review."
          : action === "resolve"
            ? "Integrity flag resolved."
            : "Integrity flag dismissed.",
      );
      setNotes((current) => ({ ...current, [id]: "" }));
      await load();
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : "Could not update integrity flag");
    } finally {
      setActionLoading(null);
    }
  }, [assigneeDrafts, load, notes]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix
        hasCriticals={counts.critical > 0 || counts.open > 0}
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-rose-900/10"
      />

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
              SYS: Integrity Review
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Documentation Integrity
              {counts.critical > 0 ? <ShieldAlert className="h-8 w-8 text-rose-400" /> : null}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-3xl">
              Review late-entry and documentation-quality flags before rounding evidence becomes hard to defend.
            </p>
          </div>
          <div>
            <RoundingHubNav />
          </div>
        </div>

        {!selectedFacilityId ? (
          <div className="rounded-[2rem] border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-950/40 px-6 py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            Select a facility in the admin header to open the integrity queue.
          </div>
        ) : null}

        {actionMessage ? <Banner tone="success">{actionMessage}</Banner> : null}
        {actionError ? <Banner tone="error">{actionError}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Open" value={String(counts.open)} accent="text-rose-500" icon={<ShieldAlert className="h-5 w-5" />} pulse={counts.open > 0} />
          <MetricCard label="In Progress" value={String(counts.in_progress)} accent="text-amber-500" icon={<Eye className="h-5 w-5" />} />
          <MetricCard label="Resolved" value={String(counts.resolved)} accent="text-emerald-500" icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricCard label="Dismissed" value={String(counts.dismissed)} accent="text-slate-400" icon={<XCircle className="h-5 w-5" />} />
          <MetricCard label="Critical" value={String(counts.critical)} accent="text-indigo-500" icon={<UserSearch className="h-5 w-5" />} pulse={counts.critical > 0} />
        </div>

        <V2Card hoverColor="indigo" className="p-6 border-indigo-500/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Integrity flag queue</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                Review suspicious rounding evidence, late-entry patterns, and other documentation-quality follow-up.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["all", "open", "in_progress", "resolved", "dismissed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition",
                    filter === value
                      ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-200"
                      : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-black/20 dark:text-zinc-400 dark:hover:border-white/20",
                  )}
                >
                  {value === "all" ? "All" : value.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 px-4 py-10 text-center text-sm text-slate-500 dark:text-zinc-500">
              No integrity flags match this filter.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {rows.map((row) => {
                const key = (action: string) => `${row.id}:${action}`;
                const log = row.resident_observation_logs;
                return (
                  <div key={row.id} className="rounded-[1.75rem] border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-950/40 p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest", STATUS_STYLES[row.status])}>
                            {row.status.replace("_", " ")}
                          </span>
                          <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest", SEVERITY_STYLES[row.severity])}>
                            {row.severity}
                          </span>
                          <span className="rounded-full border border-slate-200 dark:border-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">
                            {row.flag_type.replace(/_/g, " ")}
                          </span>
                        </div>

                        <div>
                          <h3 className="text-xl font-display tracking-tight text-slate-900 dark:text-slate-100">
                            {personName(row.residents, row.resident_id?.slice(0, 8) ?? "No resident linked")}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                            Staff: {personName(row.staff, row.staff_id?.slice(0, 8) ?? "Unassigned")}
                          </p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
                            Owner: {personName(row.assigned_staff, row.assigned_to_staff_id ?? "Unassigned")}
                            {row.assigned_at ? ` · assigned ${new Date(row.assigned_at).toLocaleString()}` : ""}
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-600 dark:text-zinc-400">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Detected</p>
                            <p>{new Date(row.detected_at).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Entry mode</p>
                            <p>{log?.entry_mode?.replace(/_/g, " ") ?? "Unavailable"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Observed</p>
                            <p>{log ? new Date(log.observed_at).toLocaleString() : "Unavailable"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Entered</p>
                            <p>{log ? new Date(log.entered_at).toLocaleString() : "Unavailable"}</p>
                          </div>
                        </div>

                        {log?.late_reason ? (
                          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3.5 py-3 text-sm text-slate-600 dark:text-zinc-300">
                            Late reason: {log.late_reason}
                          </div>
                        ) : null}

                        {log?.note ? (
                          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3.5 py-3 text-sm text-slate-600 dark:text-zinc-300">
                            {log.note}
                          </div>
                        ) : null}

                        {row.disposition_note ? (
                          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3.5 py-3 text-sm text-slate-600 dark:text-zinc-300">
                            {row.disposition_note}
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-[260px] space-y-3">
                        <textarea
                          value={notes[row.id] ?? ""}
                          onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                          rows={3}
                          placeholder="Review note or disposition..."
                          className="w-full rounded-2xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/10"
                        />

                        {assigneeOptions.length > 0 ? (
                          <div className="space-y-2">
                            <select
                              value={assigneeDrafts[row.id] ?? ""}
                              onChange={(event) =>
                                setAssigneeDrafts((current) => ({
                                  ...current,
                                  [row.id]: event.target.value,
                                }))
                              }
                              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
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
                              onClick={() => void runAction(row.id, "assign")}
                              disabled={actionLoading === `${row.id}:assign`}
                              className="rounded-full"
                            >
                              {actionLoading === `${row.id}:assign` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Save owner
                            </Button>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          {row.status === "open" ? (
                            <Button
                              type="button"
                              onClick={() => void runAction(row.id, "start_review")}
                              disabled={actionLoading === key("start_review")}
                              className="rounded-full bg-amber-600 text-white hover:bg-amber-500"
                            >
                              {actionLoading === key("start_review") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
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

                        {historyById[row.id]?.length ? (
                          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3.5 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">History</p>
                            <ul className="mt-2 space-y-2 text-xs text-slate-600 dark:text-zinc-300">
                              {historyById[row.id].slice(0, 4).map((item) => (
                                <li key={item.id}>
                                  <span className="font-semibold">{item.action}</span>
                                  {item.changedFields.length > 0 ? ` · ${item.changedFields.join(", ")}` : ""}
                                  {` · ${item.actorName} · ${new Date(item.createdAt).toLocaleString()}`}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
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
    <V2Card hoverColor="indigo" className="p-5 border-slate-200 dark:border-white/5">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className={cn("flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest", accent)}>
          {icon}
          {label}
          {pulse ? <span className="ml-auto h-2 w-2 rounded-full bg-rose-500" /> : null}
        </div>
        <div className={cn("text-4xl font-display tracking-tight", accent)}>{value}</div>
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
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "success"
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
          : "border-rose-500/20 bg-rose-500/10 text-rose-200",
      )}
    >
      {children}
    </div>
  );
}
