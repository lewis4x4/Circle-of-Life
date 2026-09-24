"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { residentReviewMap } from "@/lib/operations/resident-review-map";
import { recordResidentSourceReviewSchema, residentSourceCandidatesReplySchema, type ResidentReviewFamily, type ResidentSourceCandidatesReply, type ResidentSourceCandidate } from "@/lib/operations/resident-review-sources";
import type { WorkspaceItem } from "@/lib/operations/workspace";
import { CONTROL, WorkInputs, typedValues, type Values } from "./work-inputs";
import { enumLabel } from "@/lib/display/enum-label";

type Props = { item: WorkspaceItem; actorId: string; actorName: string | null; facilityId: string; timezone: string; disabled: boolean; onLockChange: (locked: boolean) => void; onSaved: (body: Record<string, unknown>) => void };
const labels: Record<ResidentReviewFamily, string> = { rounding: "Recorded rounding observations", vital_observation: "Recorded vital observations", form_1823: "1823 receipt metadata", resident_contact: "Resident contact metadata" };
export function ResidentSourceReview(props: Props) {
  return <Review key={`${props.actorId}:${props.facilityId}:${props.item.occurrence.id}:${props.item.occurrence.subject_id}`} {...props} />;
}
function Review({ item, actorId, actorName, timezone, disabled, onSaved, onLockChange }: Props) {
  const mapping = residentReviewMap.find(row => item.occurrence.activity_key ? row.key === item.occurrence.activity_key : row.id === item.occurrence.activity_id);
  const [opened, setOpened] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [family, setFamily] = useState<ResidentReviewFamily>(mapping?.families[0] ?? "rounding");
  const [selected, setSelected] = useState<ResidentSourceCandidate[]>([]);
  const [values, setValues] = useState<Values>({});
  const [outcome, setOutcome] = useState("performed");
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const active = useRef(true);
  const sending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); onLockChange(false); }; }, [onLockChange]);
  if (!mapping) return null;
  const locked = busy || pending !== null;
  const taskId = item.occurrence.id;
  async function send(body: string) {
    if (sending.current || disabled) return;
    sending.current = true; onLockChange(true); setPending(body); setBusy(true); setError(""); setNotice("");
    controller.current = new AbortController();
    try {
      const response = await fetch(`/api/admin/operations/occurrences/${taskId}/source-review`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, signal: controller.current.signal });
      const result = await response.json();
      if (!active.current) return;
      if (!response.ok) {
        if (response.status < 500 && ![408, 429].includes(response.status)) {
          onLockChange(false); setPending(null); setSelected([]); setGeneration(n => n + 1);
          setError("Review was rejected. Reload current sources and check the task before trying again. The manual workflow remains available."); return;
        }
        throw new Error("Unknown result");
      }
      if (result.outcome !== "receipt" || !result.receipt?.id || result.occurrence?.id !== taskId || result.receipt.recorder_id !== actorId || !Array.isArray(result.references) || result.references.length !== JSON.parse(body).references.length || result.references.some((reference: { reference_id?: unknown }) => typeof reference.reference_id !== "string")) throw new Error("Unverified reply");
      onLockChange(false); setPending(null); setSelected([]); setGeneration(n => n + 1); onSaved(result);
      setNotice("Review recorded. Required evidence and any separate verification still apply.");
    } catch {
      if (active.current) setError("The save result is unknown. Keep this task open and retry the same review before recording another change.");
    } finally { sending.current = false; if (active.current) setBusy(false); }
  }
  function submit() {
    if (locked || disabled || !item.rules?.can_record) return;
    try {
      const payload = { outcome, values: typedValues(item.rules.inputs, values, timezone), ...(note.trim() ? { note: note.trim() } : {}), ...(outcome === "failed" ? { issue: { kind: "failed_result", summary: issue.trim(), severity: "normal" } } : {}) };
      const body = recordResidentSourceReviewSchema.parse({ request_key: crypto.randomUUID(), expected_occurrence_revision: item.occurrence.occurrence_revision, period: { start_date: start, end_date: end }, references: selected.map(source => ({ family, source_id: source.source_id, source_version: source.source_version })), payload });
      void send(JSON.stringify(body));
    } catch { setError("Choose a valid review period and source, and complete the required findings. A current task revision is required."); }
  }
  return <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className={`${CONTROL} cursor-pointer`}>Resident review source context</summary>
    {opened ? <div role="group" className="space-y-4 pt-3" aria-label="Resident review source context">
      <p>{mapping.sourceId}: {mapping.label}. {mapping.fallback}</p>
      <p>Sources support your review; they do not prove complete clinical coverage, provider approval, a signature, or completion of native care.</p>
      <details><summary className={`${CONTROL} cursor-pointer`}>All 36 source items and 41 components</summary><ul>{residentReviewMap.map(row => <li key={row.key}>{row.sourceId} · {row.label} · {enumLabel(row.kind, { case: "lower" })} · {row.subjectKind ?? "Subject unknown"}: {row.families.length ? row.families.map(value => labels[value]).join(", ") : "Native or manual workflow"}. {row.fallback}</li>)}</ul></details>
      {mapping.families.length ? <>
        <p>Recorded by {actorName ?? actorId} at the current time. The review period below is separate. For earlier work or work performed by someone else, use the existing manual form without current-version proof.</p>
        {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
        {pending ? <button type="button" className={CONTROL} disabled={busy || disabled} onClick={() => void send(pending)}>Retry same review</button> : null}
        <fieldset disabled={locked || disabled} className="space-y-3">
          <legend>Source selection</legend>
          <label className="block">Review start date<input className={CONTROL} type="date" value={start} onChange={event => { setStart(event.target.value); setSelected([]); }} /></label>
          <label className="block">Review end date<input className={CONTROL} type="date" value={end} onChange={event => { setEnd(event.target.value); setSelected([]); }} /></label>
          <label className="block">Source family<select className={CONTROL} value={family} onChange={event => { setFamily(event.target.value as ResidentReviewFamily); setSelected([]); }}>{mapping.families.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
          {start && end && start <= end ? <Candidates key={`${taskId}:${family}:${start}:${end}:${generation}`} taskId={taskId} family={family} start={start} end={end} selected={selected} onSelect={setSelected} /> : <p>Select the explicit period to load source context.</p>}
        </fieldset>
        <form onSubmit={event => { event.preventDefault(); submit(); }}>
          <fieldset disabled={locked || disabled || !item.rules?.can_record} className="space-y-3">
            <legend>Record your review</legend>
            <WorkInputs timezone={timezone} rules={item.rules?.inputs ?? []} values={values} onChange={setValues} prefix={`${taskId}-source-review`} />
            <label className="block">Review outcome<select className={CONTROL} value={outcome} onChange={event => setOutcome(event.target.value)}><option value="performed">Performed</option><option value="failed">Failed</option><option value="not_performed">Not performed</option></select></label>
            <label className="block">Review findings<textarea className={CONTROL} value={note} onChange={event => setNote(event.target.value)} /></label>
            {outcome === "failed" ? <label className="block">Issue summary<textarea className={CONTROL} required value={issue} onChange={event => setIssue(event.target.value)} /></label> : null}
            <button className={CONTROL} disabled={!selected.length || !item.occurrence.occurrence_revision}>Record review with selected sources</button>
          </fieldset>
        </form>
      </> : <p>This component uses its existing native or manual workflow. No source-review action is available.</p>}
    </div> : null}
  </details>;
}
function Candidates({ taskId, family, start, end, selected, onSelect }: { taskId: string; family: ResidentReviewFamily; start: string; end: string; selected: ResidentSourceCandidate[]; onSelect: (value: ResidentSourceCandidate[]) => void }) {
  const [data, setData] = useState<ResidentSourceCandidatesReply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const load = useCallback(async (cursor?: string) => {
    if (loading.current) return;
    loading.current = true; setBusy(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const query = new URLSearchParams({ task_id: taskId, family, start_date: start, end_date: end, ...(cursor ? { cursor } : {}) });
      const response = await fetch(`/api/admin/operations/resident-review-sources?${query}`, { credentials: "same-origin", cache: "no-store", signal: abort.signal });
      const body = residentSourceCandidatesReplySchema.parse(await response.json());
      if (!response.ok || body.task_id !== taskId || body.family !== family || body.period.start_date !== start || body.period.end_date !== end || (body.availability === "available" && (!body.eligible || !body.allowed_families.includes(family))) || body.complete !== (body.next_cursor === null) || (cursor && body.next_cursor !== null && body.next_cursor <= cursor)) throw new Error("Unavailable source reply");
      if (active.current && !abort.signal.aborted) setData(previous => ({ ...body, items: cursor ? [...(previous?.items ?? []), ...body.items] : body.items }));
    } catch { if (active.current && !abort.signal.aborted) { setData(null); onSelect([]); setError("Source context unavailable. Retry or use the existing manual workflow; unavailable does not mean no records exist."); } }
    finally { if (!abort.signal.aborted) { loading.current = false; if (active.current) setBusy(false); } }
  }, [taskId, family, start, end, onSelect]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; controller.current?.abort(); loading.current = false; }; }, [load]); // Scope changes remount this reader and abort its request.
  return <div className="space-y-2">
    {busy ? <p role="status">Loading source context…</p> : null}{error ? <p role="alert">{error}</p> : null}
    {data ? <><p>{data.reason ?? "Only this source family is shown."} {data.complete ? "This family page set is complete; it does not establish full clinical review coverage." : "More source pages remain."}</p>
      {data.availability === "available" && data.eligible ? <ul>{data.items.map(source => <li key={`${source.source_id}:${source.source_version}`}><label><input type="checkbox" checked={selected.some(row => row.source_id === source.source_id)} disabled={!selected.some(row => row.source_id === source.source_id) && selected.length >= 32} onChange={event => onSelect(event.target.checked ? [...selected, source] : selected.filter(row => row.source_id !== source.source_id))} /> {source.label} · {source.source_at ?? "Source date unavailable"} · Version {source.source_version.slice(0, 12)}</label><p>{source.evidence_meaning}</p></li>)}</ul> : <p>No source selection is available. Use the manual workflow when authorized.</p>}
      {data.next_cursor ? <button type="button" className={CONTROL} disabled={busy} onClick={() => void load(data.next_cursor!)}>Load more source context</button> : null}
    </> : null}
    {error ? <button type="button" className={CONTROL} disabled={busy} onClick={() => void load()}>Retry source read</button> : null}
  </div>;
}
