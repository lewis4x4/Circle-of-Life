"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flag } from "lucide-react";

type FeedbackRow = {
  id: string;
  category: string;
  severity: string;
  title: string;
  detail: string;
  route: string;
  shell_kind: string;
  app_role: string;
  user_email: string | null;
  status: string;
  facility_id: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-warning/10 text-warning border border-warning/30",
  triaged: "bg-info/10 text-info border border-info/30",
  planned: "bg-muted text-muted-foreground border border-border",
  done: "bg-success/10 text-success border border-success/30",
  dismissed: "bg-muted text-muted-foreground border border-border",
};

export default function PilotFeedbackInboxPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [shellFilter, setShellFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pilot-feedback", { credentials: "same-origin" });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; feedback?: FeedbackRow[] };
      if (!res.ok || payload.ok !== true) {
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      setRows(payload.feedback ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load pilot feedback");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const visibleRows = rows.filter((row) => {
      const matchesStatus = activeStatusFilter === "all" || row.status === activeStatusFilter;
      const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
      const matchesSeverity = severityFilter === "all" || row.severity === severityFilter;
      const matchesShell = shellFilter === "all" || row.shell_kind === shellFilter;
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [
          row.title,
          row.detail,
          row.route,
          row.user_email ?? "",
          row.app_role,
          row.category,
          row.shell_kind,
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedSearch);
      return (
        matchesStatus &&
        matchesCategory &&
        matchesSeverity &&
        matchesShell &&
        matchesSearch
      );
    });

    return visibleRows.reduce<Record<string, FeedbackRow[]>>((acc, row) => {
      const key = row.status;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [activeStatusFilter, categoryFilter, rows, search, severityFilter, shellFilter]);

  const statusCounts = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    setError(null);
    try {
      const res = await fetch("/api/pilot-feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id, status }),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || payload.ok !== true) {
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update feedback status");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <div className="rounded-[var(--radius)] border border-border bg-card p-8 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Pilot Feedback
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
          COL Feedback Inbox
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Structured likes, dislikes, bugs, confusion, and feature requests captured from live testing inside Haven.
        </p>
      </div>

      {error ? (
        <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[var(--radius)] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Loading feedback…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No pilot feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 rounded-[var(--radius)] border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Title, detail, route, user…"
                className="h-11 rounded-[var(--radius)] border border-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Category
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-11 rounded-[var(--radius)] border border-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
              >
                <option value="all">All</option>
                <option value="bug">Bug</option>
                <option value="confusion">Confusing</option>
                <option value="request">Feature request</option>
                <option value="friction">Friction</option>
                <option value="praise">Praise</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Severity
              <select
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value)}
                className="h-11 rounded-[var(--radius)] border border-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
              >
                <option value="all">All</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Shell
              <select
                value={shellFilter}
                onChange={(event) => setShellFilter(event.target.value)}
                className="h-11 rounded-[var(--radius)] border border-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
              >
                <option value="all">All</option>
                <option value="admin">Admin</option>
                <option value="caregiver">Caregiver</option>
                <option value="family">Family</option>
                <option value="med-tech">Med-tech</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {["all", "new", "triaged", "planned", "done", "dismissed"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setActiveStatusFilter(status)}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeStatusFilter === status
                    ? "bg-foreground text-background"
                    : "border border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {status} {status === "all" ? `(${rows.length})` : `(${statusCounts[status] ?? 0})`}
              </button>
            ))}
          </div>

          {Object.entries(grouped).map(([status, items]) => (
            <section key={status} className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${STATUS_STYLES[status] ?? STATUS_STYLES.new}`}>
                  {status}
                </span>
                <span className="text-sm text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>

              <div className="grid gap-4">
                {items.map((row) => (
                  <div key={row.id} className="min-h-[36px] rounded-[9px] border border-border bg-card px-[13px] py-2 hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <Flag className="h-3.5 w-3.5" />
                            {row.category}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {row.severity}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {row.shell_kind}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-foreground">{row.title}</h2>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{row.detail}</p>
                        <div className="flex flex-wrap gap-2 pt-2">
                          {["new", "triaged", "planned", "done", "dismissed"].map((nextStatus) => (
                            <button
                              key={nextStatus}
                              type="button"
                              disabled={updatingId === row.id || nextStatus === row.status}
                              onClick={() => void updateStatus(row.id, nextStatus)}
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                                nextStatus === row.status
                                  ? STATUS_STYLES[nextStatus] ?? STATUS_STYLES.new
                                  : "border border-border bg-card text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {updatingId === row.id && nextStatus !== row.status ? "Updating…" : nextStatus}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="min-w-[240px] rounded-[var(--radius)] border border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
                        <div>User: {row.user_email ?? "unknown"}</div>
                        <div>Role: {row.app_role}</div>
                        <div>Route: <span className="font-medium">{row.route}</span></div>
                        <div>Facility: <span className="font-medium">{row.facility_id ?? "none"}</span></div>
                        <div>Submitted: {new Date(row.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
