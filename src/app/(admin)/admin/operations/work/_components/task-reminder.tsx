"use client";

import { useEffect, useRef, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { reminderLabel, reminderSchema, type Reminder } from "@/lib/operations/reminders";
import { DateTimeInput } from "./work-inputs";

/** A single episode is shown on its existing work row: no duplicate toast/digest or external delivery claim. */
export function TaskReminder({ occurrenceId, timezone, facilityId, actorId }: { occurrenceId: string; timezone: string; facilityId: string; actorId: string }) {
  const [issues, setIssues] = useState<Array<{id: string; summary: string}>>([]);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/admin/operations/issues?facility_id=${facilityId}&task_instance_id=${occurrenceId}`).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.issues)) throw new Error("Issue reminders unavailable.");
      if (alive) setIssues(body.issues.filter((issue: {status: string}) => issue.status !== "resolved"));
    }).catch(() => { if (alive) setError("Issue reminders unavailable. Reopen this work item to retry."); });
    return () => { alive = false; };
  }, [occurrenceId, facilityId, actorId]);
  return <div className="space-y-3">
    <ReminderEpisode key={`${actorId}:${occurrenceId}`} occurrenceId={occurrenceId} timezone={timezone} />
    {issues.slice(0, limit).map(issue => <ReminderEpisode key={`${actorId}:${occurrenceId}:${issue.id}`} occurrenceId={occurrenceId} timezone={timezone} issueId={issue.id} />)}
    {issues.length > limit ? <button className="min-h-11 rounded border px-3" type="button" onClick={() => setLimit(limit + 5)}>Show more issue reminders ({issues.length - limit} remaining)</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

function ReminderEpisode({ occurrenceId, timezone, issueId, label }: { occurrenceId: string; timezone: string; issueId?: string; label?: string }) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [until, setUntil] = useState("");
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => { alive.current = true; void command("refresh"); return () => { alive.current = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useRef<Record<string, unknown> | null>(null);
  async function command(action: "refresh" | "acknowledge" | "snooze") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError("");
    try {
      let body: Record<string, unknown> = { command: action, ...(issueId ? {issue_id: issueId} : {}) };
      if (action !== "refresh") {
        body = { command: action, ...(issueId ? {issue_id: issueId} : {}), expected_revision: reminder?.revision, request_key: crypto.randomUUID() };
        if (action === "snooze" && !pending.current) {
          const instant = fromZonedTime(until, timezone);
          if (!until || !Number.isFinite(instant.getTime()) || formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm") !== until || instant.getTime() <= Date.now()) throw new Error("Choose a future snooze time.");
          body.until = instant.toISOString();
        }
        // Preserve exactly the same request after an uncertain network outcome.
        if (pending.current) body = pending.current;
        else pending.current = body;
      }
      const response = await fetch(`/api/admin/operations/occurrences/${occurrenceId}/reminder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!alive.current) return;
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        throw new Error(result.error ?? "Reminder could not be confirmed.");
      }
      const next = reminderSchema.safeParse(result.reminder);
      if (!next.success) throw new Error("Reminder could not be confirmed. Refresh before retrying.");
      setReminder(next.data); if (action !== "refresh") pending.current = null;
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Reminder could not be confirmed. Refresh before retrying."); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section aria-label="Work reminder" className="space-y-2 border-t pt-3">
    {reminder ? <p className="font-medium">{reminder.source_label}</p> : label ? <p className="font-medium">{label}</p> : null}
    <button className="min-h-11 rounded border px-3" type="button" disabled={busy} onClick={() => void command("refresh")}>{busy ? "Checking reminder…" : reminder ? "Refresh reminder" : "Check reminder"}</button>
    {reminder ? <>
      <p>{reminderLabel(reminder)}</p>
      <p className="text-sm text-muted-foreground">Acknowledging or snoozing changes this reminder only. Record the work separately.</p>
      {reminder.can_respond ? <>
        <button className="min-h-11 rounded border px-3" type="button" disabled={busy || !!reminder.acknowledged_at || !!pending.current} onClick={() => void command("acknowledge")}>Acknowledge reminder</button>
        <DateTimeInput id={`reminder-${occurrenceId}-${issueId ?? "work"}`} label="Snooze until" value={until} onChange={setUntil} timezone={timezone} />
        <button className="min-h-11 rounded border px-3" type="button" disabled={busy || !until || !!pending.current} onClick={() => void command("snooze")}>Snooze reminder</button>
      </> : null}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    {pending.current ? <button className="min-h-11 rounded border px-3" type="button" disabled={busy} onClick={() => void command(pending.current?.command as "acknowledge" | "snooze")}>Retry saved reminder response</button> : null}
  </section>;
}
