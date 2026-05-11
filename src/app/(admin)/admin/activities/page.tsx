"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  activityProviderMethodOptions,
  confirmActivitySession,
  fetchRecentActivitySessions,
  type ActivityProviderMethod,
  type AdminActivitySession,
} from "@/lib/admin/activity-sessions-data";

function formatStamp(iso: string | null): string {
  if (!iso) return "Unconfirmed";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function AdminActivitiesPage() {
  const [sessions, setSessions] = useState<AdminActivitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [providerBySession, setProviderBySession] = useState<Record<string, ActivityProviderMethod>>({});
  const [providerNameBySession, setProviderNameBySession] = useState<Record<string, string>>({});
  const [initialsBySession, setInitialsBySession] = useState<Record<string, string>>({});
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const result = await fetchRecentActivitySessions(supabase);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setSessions(result.sessions);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pendingCount = useMemo(
    () => sessions.filter((session) => !session.cancelled && !session.confirmedAt).length,
    [sessions],
  );

  const onConfirm = useCallback(async (session: AdminActivitySession) => {
    if (savingSessionId) return;
    const providerType = providerBySession[session.id] ?? session.providerType ?? "facility_staff";
    const providerName = (providerNameBySession[session.id] ?? session.providerName ?? "").trim();
    const initials = (initialsBySession[session.id] ?? session.confirmedByInitials ?? "").trim();
    if (!providerName || !initials) {
      setError("Provider name and initials are required to confirm.");
      return;
    }

    setSavingSessionId(session.id);
    setError(null);
    const supabase = createClient();
    const result = await confirmActivitySession(supabase, {
      sessionId: session.id,
      providerType,
      providerName,
      confirmedByInitials: initials,
    });
    if (!result.ok) {
      setError(result.error);
      setSavingSessionId(null);
      return;
    }

    await load();
    setSavingSessionId(null);
  }, [initialsBySession, load, providerBySession, providerNameBySession, savingSessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="rounded-3xl border border-slate-200/60 bg-white/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Activity Session Confirmation</h1>
        <p className="mt-2 text-sm text-slate-600">Recent sessions with completion confirmation metadata.</p>
        <p className="mt-2 text-xs font-medium text-slate-500">Pending confirmations: {pendingCount}</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-3xl border border-slate-200/60 bg-white/70 shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100/80 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Facility</th>
              <th className="px-4 py-3">Confirmation</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const isSaving = savingSessionId === session.id;
              const isConfirmed = Boolean(session.confirmedAt);
              return (
                <tr key={session.id} className="border-t border-slate-200/60 align-top">
                  <td className="px-4 py-4 whitespace-nowrap">{session.sessionDate}</td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-900">{session.activityName}</div>
                    <div className="text-xs text-slate-500">{session.startTime ?? "—"} → {session.endTime ?? "—"}</div>
                    {session.cancelled ? <div className="mt-1 text-xs font-medium text-amber-700">Cancelled</div> : null}
                  </td>
                  <td className="px-4 py-4">{session.facilityName}</td>
                  <td className="px-4 py-4">
                    <div className="space-y-2 max-w-sm">
                      <div className="text-xs text-slate-500">Confirmed at: {formatStamp(session.confirmedAt)}</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <select
                          className="rounded-xl border border-slate-300 px-2 py-2 text-xs"
                          value={providerBySession[session.id] ?? session.providerType ?? "facility_staff"}
                          onChange={(event) => {
                            setProviderBySession((prev) => ({ ...prev, [session.id]: event.target.value as ActivityProviderMethod }));
                          }}
                          disabled={session.cancelled}
                        >
                          {activityProviderMethodOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <input
                          className="rounded-xl border border-slate-300 px-2 py-2 text-xs"
                          placeholder="Provider"
                          value={providerNameBySession[session.id] ?? session.providerName ?? ""}
                          onChange={(event) => {
                            setProviderNameBySession((prev) => ({ ...prev, [session.id]: event.target.value }));
                          }}
                          disabled={session.cancelled}
                        />
                        <input
                          className="rounded-xl border border-slate-300 px-2 py-2 text-xs uppercase"
                          placeholder="Initials"
                          maxLength={8}
                          value={initialsBySession[session.id] ?? session.confirmedByInitials ?? ""}
                          onChange={(event) => {
                            setInitialsBySession((prev) => ({ ...prev, [session.id]: event.target.value.toUpperCase() }));
                          }}
                          disabled={session.cancelled}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void onConfirm(session)}
                        disabled={isSaving || session.cancelled}
                      >
                        {isSaving ? "Saving..." : isConfirmed ? "Update confirmation" : "Confirm session"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No recent sessions found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
