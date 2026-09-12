"use client";

import { fromZonedTime } from "date-fns-tz";
import { useEffect, useRef, useState } from "react";
import { CONTROL, DateTimeInput } from "./work-inputs";
import { localTime } from "./receipt-history";

import type { HelpHandoverData as Snapshot, HelpHandoverEvent as Event } from "@/lib/operations/help-handover";
type Props = { activityId: string; facilityId: string; occurrenceId: string; actorId: string; timezone: string };
const endpoint = "/api/admin/operations/help-handover";

/** Remount all in-memory drafts when the current person or task scope changes. */
export function TaskHelpHandover(props: Props) {
  return <TaskHelp key={`${props.actorId}:${props.facilityId}:${props.activityId}:${props.occurrenceId}`} {...props} />;
}
function TaskHelp(props: Props) {
  const [opened, setOpened] = useState(false);
  return <details onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className={`${CONTROL} cursor-pointer`}>Task help and handover</summary>
    {opened ? <HelpPanel {...props} /> : null}
  </details>;
}
function HelpPanel({ activityId, facilityId, occurrenceId, actorId, timezone }: Props) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [howTo, setHowTo] = useState("");
  const [examples, setExamples] = useState("");
  const [contact, setContact] = useState("");
  const [scope, setScope] = useState("");
  const [owner, setOwner] = useState("");
  const [backup, setBackup] = useState("");
  const [effective, setEffective] = useState("");
  const [note, setNote] = useState("");
  const active = useRef(true);
  const sending = useRef(false);
  const url = `${endpoint}?${new URLSearchParams({ activity_id: activityId, facility_id: facilityId, occurrence_id: occurrenceId })}`;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    void fetch(url, { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || body.actor_id !== actorId || body.facility_id !== facilityId || body.activity_id !== activityId)
        throw new Error("Task help unavailable. Refresh the workspace to check your current access.");
      if (current) { setData(body); setError(""); }
    }).catch(() => { if (current) { setData(null); setError("Task help unavailable. Refresh the workspace to check your current access."); } });
    return () => { current = false; };
  }, [url, actorId, facilityId, activityId, attempt]);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  async function send(body: string) {
    if (sending.current || !active.current) return;
    sending.current = true; setBusy(true); setError(""); setNotice("");
    setPending(body);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body });
      const result = await response.json();
      if (!active.current) return;
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          setPending(null); setData(null); setAttempt((n) => n + 1);
          setNotice(typeof result.error === "string" ? result.error : "Change rejected. Current details are being checked.");
          return;
        }
        throw new Error("uncertain");
      }
      const submitted = JSON.parse(body);
      if (!result.event || typeof result.event.id !== "string" || !result.event.id || result.event.actor_id !== actorId || result.event.command !== submitted.command)
        throw new Error("Unverified save reply");
      setPending(null); setData(null); setAttempt((n) => n + 1);
      setNotice("Saved. Current details are being checked.");
    } catch {
      if (active.current) setError("The save result is unknown. Keep this task open and retry the same change before making another change.");
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }
  function command(command: string, expectedId: string | null, payload: Record<string, unknown>) {
    if (!data || pending || sending.current) return;
    void send(JSON.stringify({ activity_id: activityId, facility_id: facilityId, command, expected_id: expectedId, payload, request_key: crypto.randomUUID() }));
  }
  const person = (id: unknown) => data?.people.find((p) => p.id === id)?.name ?? (id ? "Person unavailable" : "Unassigned");
  const locked = busy || pending !== null;
  const latestProposals = new Map(data?.current_duties.map((duty) => [duty.duty_scope, duty.proposal_id]) ?? []);
  function documents(value: unknown) {
    return Array.isArray(value) && value.length > 0 ? <ul aria-label="Protected guidance documents">{value.map((document: { id: string; label: string; href: string }) => <li key={document.id}>{document.href === `/admin/facilities/${facilityId}/documents` ? <a className={CONTROL} href={document.href}>{document.label}</a> : document.label}</li>)}</ul> : null;
  }
  function eventHistory(rows: Event[], label: string) {
    return <details><summary className={`${CONTROL} cursor-pointer`}>{label}</summary>
      {rows.length === 0 ? <p>No recorded history.</p> : <ol>{rows.map((row) => <li key={row.id} className="border-l border-border pl-3">
        <p>{row.command} · {person(row.actor_id)} · {localTime(row.created_at, timezone)}</p>
        {Object.entries(row.payload).filter(([key]) => ["how_to", "examples", "contact", "duty_scope", "note", "duty_role"].includes(key)).map(([key, value]) => <p key={key}>{key.replaceAll("_", " ")}: {String(value ?? "Unknown")}</p>)}
        {row.payload.owner_user_id ? <p>Owner: {person(row.payload.owner_user_id)} · Backup: {person(row.payload.backup_user_id)}</p> : null}
        {documents(row.payload.protected_documents)}
        {row.payload.effective_at ? <p>Effective: {localTime(row.payload.effective_at, timezone)}</p> : null}
      </li>)}</ol>}
    </details>;
  }
  return <section aria-label="Task help and replacement handover" className="space-y-4 pt-3">
    <p>Help is optional. You can complete routine work without opening or acknowledging this panel.</p>
    <p>Local duty and absence-cover arrangements remain unconfirmed. Task effort has not yet been measured. A local duty proposal does not change access, schedules, completed work, or issue ownership.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {pending ? <button type="button" className={CONTROL} disabled={busy} onClick={() => void send(pending)}>Retry same change</button> : null}
    {!data && !error ? <p role="status">Loading task help…</p> : null}
    {!data && !pending ? <button type="button" className={CONTROL} onClick={() => setAttempt((n) => n + 1)}>Refresh task help</button> : null}
    {data ? <>
      <h4 className="font-semibold">Governing rules for this task</h4>
      <p>These are the pinned rule versions for this occurrence. Supplemental help below does not replace them.</p>
      <p>Requirement: {data.governing_requirement ? `Version ${String(data.governing_requirement.version ?? data.governing_requirement.id ?? "unavailable")}` : "Unknown — no governing requirement available"}</p>
      {data.governing_requirement ? <p className="whitespace-pre-wrap">{String(data.governing_requirement.title ?? "")} {String(data.governing_requirement.wording ?? "")} {String(data.governing_requirement.procedure ?? "")}</p> : null}
      <p>Facility requirement: {data.governing_facility_requirement ? `Version ${String(data.governing_facility_requirement.version ?? data.governing_facility_requirement.id ?? "unavailable")}` : "Unknown — no facility requirement available"}</p>
      {data.governing_facility_requirement ? <p className="whitespace-pre-wrap">{String(data.governing_facility_requirement.local_procedure ?? "")}</p> : null}
      {data.governing_facility_requirement ? <div className="space-y-1">
        <h5 className="font-medium">Ownership recorded in this task’s rule version</h5>
        <p>This configured ownership is historical context. It does not establish personal acceptance or current coverage.</p>
        <p>Configured owner role: {String(data.governing_facility_requirement.owner_role ?? "Unknown").replaceAll("_", " ")} · Person: {data.governing_facility_requirement.owner_user_id ? person(data.governing_facility_requirement.owner_user_id) : "Unknown"}</p>
        <p>Configured backup role: {String(data.governing_facility_requirement.backup_role ?? "Unknown").replaceAll("_", " ")} · Person: {data.governing_facility_requirement.backup_user_id ? person(data.governing_facility_requirement.backup_user_id) : "Unknown"}</p>
        <p>Rule effective from: {data.governing_facility_requirement.effective_from ? localTime(data.governing_facility_requirement.effective_from, timezone) : "Unknown"} · Effective to: {data.governing_facility_requirement.effective_to ? localTime(data.governing_facility_requirement.effective_to, timezone) : "No end recorded"} ({timezone})</p>
      </div> : null}
      <h4 className="font-semibold">Current supplemental guidance</h4>
      {data.help ? <>
        <p className="whitespace-pre-wrap">How to: {String(data.help.payload.how_to ?? "Unknown")}</p>
        <p className="whitespace-pre-wrap">Examples: {String(data.help.payload.examples ?? "Unknown")}</p>
        <p className="whitespace-pre-wrap">Contact: {String(data.help.payload.contact ?? "Unknown")}</p>
        {documents(data.help.payload.protected_documents)}
        <p>Published by {person(data.help.actor_id)} · {localTime(data.help.created_at, timezone)}</p>
      </> : <p>No supplemental guidance published. How-to, examples and contact are Unknown.</p>}
      {eventHistory(data.help_history, "Guidance history")}
      <h4 className="font-semibold">Local duties and replacement-person handover</h4>
      {data.current_duties.length === 0 ? <p>No supplemental local duty proposals recorded. Personal acceptance is unknown.</p> : <ul className="space-y-3">{data.current_duties.map((duty) => <li key={duty.proposal_id}>
        <p>{duty.duty_scope} · {duty.active ? "Active" : latestProposals.get(duty.duty_scope) !== duty.proposal_id ? "Superseded proposal" : "Pending acceptance or effective time"}</p>
        <p>Owner: {person(duty.owner_user_id)}{!duty.owner_current ? " · Current site access unavailable" : ""} · {duty.owner_accepted_at ? `Accepted ${localTime(duty.owner_accepted_at, timezone)}` : "Not accepted"}</p>
        <p>Backup: {person(duty.backup_user_id)}{duty.backup_user_id && !duty.backup_current ? " · Current site access unavailable" : ""} · {duty.backup_accepted_at ? `Accepted ${localTime(duty.backup_accepted_at, timezone)}` : "Not accepted"}</p>
        {duty.active && !duty.covered ? <p>Uncovered — a replacement must be agreed. Historical acceptance does not establish current coverage.</p> : null}
        <p>Effective: {localTime(duty.effective_at, timezone)} ({timezone})</p>
        {(["owner", "backup"] as const).map((role) => latestProposals.get(duty.duty_scope) === duty.proposal_id && duty[`${role}_user_id`] === actorId && !duty[`${role}_accepted_at`] ? <button key={role} type="button" className={CONTROL} disabled={locked} onClick={() => command("accept", duty.latest_event_id, { proposal_id: duty.proposal_id, duty_role: role })}>Accept {role} duty: {duty.duty_scope}</button> : null)}
      </li>)}</ul>}
      <h4 className="font-semibold">Open responsibilities to review</h4>
      <p>These remain on their existing task and issue records. A handover does not reassign or close them.</p>
      {data.open_issues.length === 0 ? <p>No open issues.</p> : <ul>{data.open_issues.map((row) => <li key={String(row.id)}>{String(row.summary ?? "Issue")} · {String(row.status ?? "Unknown")} · Owner: {person(row.owner_user_id)}</li>)}</ul>}
      {data.open_occurrences.length === 0 ? <p>No open occurrences.</p> : <ul>{data.open_occurrences.map((row) => <li key={String(row.id)}>{String(row.activity_name ?? row.template_name ?? row.subject_label ?? "Task")} · {String(row.status ?? "Unknown")} · Assigned to: {person(row.assigned_to)} · {row.due_at ? localTime(row.due_at, timezone) : "Unknown schedule"}</li>)}</ul>}
      {eventHistory(data.duty_history, "Duty and handover history")}
      {data.can_publish ? <details><summary className={`${CONTROL} cursor-pointer`}>Publish supplemental help</summary>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); command("help", data.help?.id ?? null, { how_to: howTo, examples, contact }); }}>
          <fieldset disabled={locked} className="space-y-3"><legend>New guidance revision</legend>
            <p>Enter the complete replacement guidance. Do not include resident information.</p>
            <label className="flex flex-col">How to<textarea required maxLength={8000} className={CONTROL} value={howTo} onChange={(event) => setHowTo(event.target.value)} /></label>
            <label className="flex flex-col">Examples<textarea maxLength={4000} className={CONTROL} value={examples} onChange={(event) => setExamples(event.target.value)} /></label>
            <label className="flex flex-col">Contact<input maxLength={1000} className={CONTROL} value={contact} onChange={(event) => setContact(event.target.value)} /></label>
            <button type="submit" className={CONTROL}>Publish help</button>
          </fieldset>
        </form></details> : null}
      {data.can_assign ? <details><summary className={`${CONTROL} cursor-pointer`}>Propose local duty or replacement</summary>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          const instant = fromZonedTime(effective, timezone);
          if (!effective || Number.isNaN(instant.getTime())) { setError("Choose an effective date and time."); return; }
          command("propose", data.current_duties.find((duty) => duty.duty_scope === scope.trim())?.latest_event_id ?? null, { duty_scope: scope.trim(), owner_user_id: owner, ...(backup ? { backup_user_id: backup } : {}), effective_at: instant.toISOString(), note });
        }}><fieldset disabled={locked} className="space-y-3"><legend>Duty proposal</legend>
          <label className="flex flex-col">Duty scope<input required maxLength={200} className={CONTROL} value={scope} onChange={(event) => setScope(event.target.value)} /></label>
          <label className="flex flex-col">Proposed owner<select required className={CONTROL} value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Choose a person</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="flex flex-col">Proposed backup<select className={CONTROL} value={backup} onChange={(event) => setBackup(event.target.value)}><option value="">No backup proposed</option>{data.people.filter((p) => p.id !== owner).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <DateTimeInput id={`${occurrenceId}-duty-effective`} label="Effective from" required timezone={timezone} value={effective} onChange={setEffective} />
          <label className="flex flex-col">Handover note<textarea required maxLength={2000} className={CONTROL} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="submit" className={CONTROL}>Propose duty</button>
        </fieldset></form></details> : null}
    </> : null}
  </section>;
}
