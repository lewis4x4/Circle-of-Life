"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { residentReviewHistoryReplySchema as historySchema } from "@/lib/operations/resident-review-sources";
import { CONTROL } from "./work-inputs";
import { localTime } from "./receipt-history";
type Props = { taskId: string; actorId: string; facilityId: string; timezone: string };
export function ResidentSourceHistory(props: Props) { return <History key={`${props.taskId}:${props.actorId}:${props.facilityId}`} {...props} />; }
function History({ taskId, timezone }: Props) {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<z.infer<typeof historySchema> | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  const sending = useRef(false);
  const command = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; command.current?.abort(); }; }, []);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController(); let current = true;
    void fetch(`/api/admin/operations/occurrences/${taskId}/source-reviews`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async response => {
      const body = historySchema.parse(await response.json());
      if (!response.ok || body.task_id !== taskId) throw new Error("History unavailable");
      if (current) setData(body);
    }).catch(() => { if (current) { setData(null); setError("Source review history unavailable. Earlier receipt success does not establish current source availability."); } });
    return () => { current = false; controller.abort(); };
  }, [opened, attempt, taskId]);
  async function recheck(body: string) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setPending(body); setError(""); command.current = new AbortController();
    try {
      const response = await fetch(`/api/admin/operations/occurrences/${taskId}/source-reviews/recheck`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, signal: command.current.signal });
      const result = await response.json();
      if (!active.current) return;
      if (!response.ok) {
        if (response.status < 500 && ![408, 429].includes(response.status)) { setPending(null); setData(null); setError("Recheck rejected. Refresh current history before another attempt."); return; }
        throw new Error("Unknown recheck");
      }
      const checked = historySchema.parse(result);
      if (checked.task_id !== taskId || !checked.reviews.some(review => review.references.some(reference => reference.reference_id === JSON.parse(body).reference_id))) throw new Error("Unverified recheck");
      setPending(null); setData(checked);
    } catch { if (active.current) { setData(null); setError("Recheck result unknown. Retry the same recheck before another change."); } }
    finally { sending.current = false; if (active.current) setBusy(false); }
  }
  return <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}><summary className={`${CONTROL} cursor-pointer`}>Versioned source review history</summary>
    {opened ? <div className="space-y-3 pt-3"><p>Original review receipts are historical. Current source checks do not verify the review or create clinical work.</p>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <button type="button" className={CONTROL} disabled={busy} onClick={() => void recheck(pending)}>Retry same recheck</button> : <button type="button" className={CONTROL} onClick={() => { setData(null); setError(""); setAttempt(value => value + 1); }}>Refresh source history</button>}
      {data?.reviews.length === 0 ? <p>No versioned source reviews recorded.</p> : null}
      {data?.reviews.map(review => <div key={review.receipt_id} className="border-l border-border pl-3"><p>Original review: {localTime(review.recorded_at, timezone)}</p>{review.references.map(reference => <div key={reference.reference_id}>
        <p>Current source eligibility/version: {reference.current_state}. {reference.requires_review || reference.current_state !== "current" ? "Review required." : "Current version matches the recorded reference."}</p>
        {reference.source_id && reference.family ? <p>{reference.family?.replaceAll("_", " ")} · Version {reference.source_version?.slice(0, 12)} · Review period {reference.period?.start_date} to {reference.period?.end_date}</p> : <p>Source details unavailable under current access.</p>}
        <button type="button" className={CONTROL} disabled={busy || pending !== null} onClick={() => void recheck(JSON.stringify({ request_key: crypto.randomUUID(), reference_id: reference.reference_id }))}>Recheck source version</button>
        <ul>{reference.checks.map((check, index) => <li key={`${check.checked_at}:${index}`}>{localTime(check.checked_at, timezone)}: {check.state}</li>)}</ul>
      </div>)}</div>)}
    </div> : null}
  </details>;
}
