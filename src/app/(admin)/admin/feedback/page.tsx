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
  new: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  triaged: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  planned: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  dismissed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export default function PilotFeedbackInboxPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>("all");
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
    const visibleRows =
      activeStatusFilter === "all"
        ? rows
        : rows.filter((row) => row.status === activeStatusFilter);

    return visibleRows.reduce<Record<string, FeedbackRow[]>>((acc, row) => {
      const key = row.status;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [activeStatusFilter, rows]);

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
      <div className="rounded-[2rem] border border-slate-200/60 bg-white/60 p-8 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.03]">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
          Pilot Feedback
        </div>
        <h1 className="mt-4 text-4xl font-display font-semibold tracking-tight text-slate-900 dark:text-white">
          COL Feedback Inbox
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600 dark:text-zinc-400">
          Structured likes, dislikes, bugs, confusion, and feature requests captured from live testing inside Haven.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white/60 px-5 py-10 text-center text-sm text-slate-500 backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400">
          Loading feedback…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 px-5 py-10 text-center text-sm text-slate-500 backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400">
          No pilot feedback has been submitted yet.
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap gap-2">
            {["all", "new", "triaged", "planned", "done", "dismissed"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setActiveStatusFilter(status)}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest transition-colors ${
                  activeStatusFilter === status
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                }`}
              >
                {status} {status === "all" ? `(${rows.length})` : `(${statusCounts[status] ?? 0})`}
              </button>
            ))}
          </div>

          {Object.entries(grouped).map(([status, items]) => (
            <section key={status} className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${STATUS_STYLES[status] ?? STATUS_STYLES.new}`}>
                  {status}
                </span>
                <span className="text-sm text-slate-500 dark:text-zinc-400">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </div>

              <div className="grid gap-4">
                {items.map((row) => (
                  <div key={row.id} className="rounded-[1.5rem] border border-slate-200/70 bg-white/70 p-5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
                            <Flag className="h-3.5 w-3.5" />
                            {row.category}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-white/10 dark:bg-black/30 dark:text-zinc-300">
                            {row.severity}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:border-white/10 dark:bg-black/30 dark:text-zinc-300">
                            {row.shell_kind}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{row.title}</h2>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-zinc-300">{row.detail}</p>
                        <div className="flex flex-wrap gap-2 pt-2">
                          {["new", "triaged", "planned", "done", "dismissed"].map((nextStatus) => (
                            <button
                              key={nextStatus}
                              type="button"
                              disabled={updatingId === row.id || nextStatus === row.status}
                              onClick={() => void updateStatus(row.id, nextStatus)}
                              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
                                nextStatus === row.status
                                  ? STATUS_STYLES[nextStatus] ?? STATUS_STYLES.new
                                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-black/20 dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                              }`}
                            >
                              {updatingId === row.id && nextStatus !== row.status ? "Updating…" : nextStatus}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="min-w-[240px] rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-zinc-400">
                        <div>User: {row.user_email ?? "unknown"}</div>
                        <div>Role: {row.app_role}</div>
                        <div>Route: <span className="font-mono">{row.route}</span></div>
                        <div>Facility: <span className="font-mono">{row.facility_id ?? "none"}</span></div>
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
