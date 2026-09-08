"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { facilityDatetimeLocalToUtcIso, utcIsoToFacilityDatetimeLocal } from "@/lib/facility-wall-clock";
import { commandReferralNextAction, getReferralNextActionReceipt, listReferralNextActionAssignees, listReferralNextActionEvents, listReferralNextActions, readRecoveryIdentifiers, removeRecoveryIdentifier, referralActionRejection, saveRecoveryIdentifier, type NextActionRecord, type NextActionAssignee, type NextActionCommand, type NextActionCursor, type NextActionEvent, type NextActionTerms, type NextActionView, type RecoveryScope } from "@/lib/referrals/next-actions";

const writers = ["owner", "org_admin", "facility_admin", "nurse"];
const inputClass = "mt-1 block w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
function dateLabel(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(date.getUTCSeconds() ? { second: "2-digit" as const } : {}), timeZoneName: "short" }).format(date);
}
function personLabel(name: string | null | undefined, id: string | null | undefined) { return name?.trim() || `Person ID ${id?.slice(-8) ?? "unavailable"}`; }
function assigneeLabel(person: NextActionAssignee, people: NextActionAssignee[]) {
  const peers = people.filter((candidate) => candidate.full_name.trim().toLowerCase() === person.full_name.trim().toLowerCase());
  let length = 8;
  while (length < person.id.length && peers.some((candidate) => candidate.id !== person.id && candidate.id.slice(-length) === person.id.slice(-length))) length += 4;
  return `${personLabel(person.full_name, person.id)} · ${person.app_role.replaceAll("_", " ")}${peers.length > 1 && person.full_name.trim() ? ` · ID ${person.id.slice(-length)}` : ""}`;
}
function RecordedTerms({ title, state, people }: { title: string; state: NextActionRecord | null; people: NextActionAssignee[] }) {
  if (!state) return <div><h4 className="font-medium">{title}</h4><p>No prior action.</p></div>;
  const identity = (id: string | null) => id ? `${people.find((person) => person.id === id)?.full_name.trim() || "Person"} · ID ${id}` : "None";
  const terms = [
    ["Action", state.action_text], ["Owner", identity(state.owner_id)], ["Backup", identity(state.backup_id)],
    ["Due", state.due_at ? dateLabel(state.due_at) : "No due date recorded"],
    ["Waiting condition", state.waiting_condition || "None"], ["Dependency", state.dependency_text || "None"],
    ["Owner acknowledgment", state.owner_acknowledged_at && state.owner_acknowledged_version === state.terms_version ? `Recorded ${dateLabel(state.owner_acknowledged_at)}` : "Not recorded for these terms"],
    ["Backup acceptance", state.backup_accepted_at && state.backup_accepted_version === state.terms_version ? `Recorded ${dateLabel(state.backup_accepted_at)}` : "Not recorded for these terms"],
  ];
  return <div className="min-w-0"><h4 className="font-medium">{title}</h4><dl className="mt-2 space-y-2">{terms.map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl></div>;
}
function ReplacementTerms({ payload, actionId, people }: { payload: unknown; actionId: string | null; people: NextActionAssignee[] }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return <p>Replacement terms are unavailable.</p>;
  const record = payload as Record<string, unknown>;
  const fields = [["Action", "action_text"], ["Owner", "owner_id"], ["Backup", "backup_id"], ["Due", "due_at"], ["Waiting condition", "waiting_condition"], ["Dependency", "dependency_text"]];
  return <div className="mt-3 min-w-0"><h4 className="font-medium">Replacement</h4>{actionId && <p className="break-words">Action reference: {actionId}</p>}<dl className="mt-2 space-y-2">{fields.map(([label, key]) => {
    const value = record[key];
    let text = value == null ? "None" : typeof value === "string" ? value : JSON.stringify(value);
    if ((key === "owner_id" || key === "backup_id") && typeof value === "string") text = `${people.find((person) => person.id === value)?.full_name.trim() || "Person"} · ID ${value}`;
    if (key === "due_at" && typeof value === "string" && Number.isFinite(Date.parse(value))) text = dateLabel(value);
    return <div key={key}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words">{text}</dd></div>;
  })}</dl></div>;
}
type Props = { leadId: string; facilityId: string; organizationId: string };
export function ReferralNextActionPanel(props: Props) {
  const { user, appRole, loading } = useHavenAuth();
  if (loading || !user) return null;
  return <ScopedPanel key={`${props.organizationId}:${props.facilityId}:${props.leadId}:${user.id}:${appRole}`} {...props} userId={user.id} canManage={writers.includes(appRole)} />;
}
type Editor = { command: "create" | "update" | "supersede"; base: NextActionView | null; terms: NextActionTerms; dueLocal: string; evidence: string };
function ScopedPanel({ leadId, facilityId, organizationId, userId, canManage }: Props & { userId: string; canManage: boolean }) {
  const [action, setAction] = useState<NextActionView | null>(null);
  const [events, setEvents] = useState<NextActionEvent[]>([]);
  const [eventCursor, setEventCursor] = useState<NextActionCursor | null>(null);
  const [assignees, setAssignees] = useState<NextActionAssignee[]>([]);
  const [assigneeCursor, setAssigneeCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [completion, setCompletion] = useState<{ text: string; base: NextActionView } | null>(null);
  const alive = useRef(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const scope: RecoveryScope = { user_id: userId, organization_id: organizationId, facility_id: facilityId, lead_id: leadId };

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const client = createClient();
      try {
        const pending = readRecoveryIdentifiers(sessionStorage, { user_id: userId, organization_id: organizationId, facility_id: facilityId, lead_id: leadId });
        let confirmed = 0;
        for (const identifier of pending) {
          const result = await getReferralNextActionReceipt(client, identifier.request_id, leadId);
          if (!alive.current || current !== generation.current) return;
          if (result) { removeRecoveryIdentifier(sessionStorage, identifier, identifier.request_id); confirmed++; }
        }
        if (pending.length > confirmed) setMessage(`${confirmed ? "Previous save confirmed; " : ""}Save not confirmed for ${pending.length - confirmed} attempt(s). Their recovery identifiers remain available. Refresh to check again; draft text is not stored across reloads.`);
        else if (confirmed) setMessage("Previous save confirmed. Current action is shown below.");
      } catch { if (alive.current && current === generation.current) setMessage("Save recovery is unavailable. Reload recovery cannot be guaranteed."); }

      const [actions, history, candidates] = await Promise.all([listReferralNextActions(client, facilityId, { leadId }), listReferralNextActionEvents(client, leadId), canManage ? listReferralNextActionAssignees(client, facilityId) : Promise.resolve({ items: [], next_cursor: null })]);
      if (!alive.current || current !== generation.current) return;
      setAction(actions.items[0] ?? null); setEvents(history.items); setEventCursor(history.next_cursor); setAssignees(candidates.items); setAssigneeCursor(candidates.next_cursor);
    } catch { if (alive.current && current === generation.current) setError("Next action could not be loaded. Refresh before making changes."); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [facilityId, leadId, canManage, userId, organizationId]);

  useEffect(() => {
    alive.current = true;
    const lifecycle = generation;
    void load();
    return () => { alive.current = false; lifecycle.current++; };
  }, [facilityId, leadId, organizationId, userId, load]);

  async function run(command: NextActionCommand, payload: Record<string, unknown>, base = action) {
    if (lock.current || loading) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    let attemptedRequestId: string | null = null;
    try {
      let pending: ReturnType<typeof readRecoveryIdentifiers> = [];
      try { pending = readRecoveryIdentifiers(sessionStorage, scope); } catch { setMessage("Browser storage is unavailable; reload recovery is not available."); }
      let recovered = false;
      for (const identifier of pending) {
        const confirmed = await getReferralNextActionReceipt(createClient(), identifier.request_id, leadId);
        if (!alive.current) return;
        if (confirmed) { removeRecoveryIdentifier(sessionStorage, scope, identifier.request_id); recovered = true; }
      }
      if (recovered) {
        setMessage("Previous save confirmed. Your draft is retained; review current work before saving another change.");
        await load();
        return;
      }
      const requestId = crypto.randomUUID();
      attemptedRequestId = requestId;
      let recoveryAvailable = true;
      try { saveRecoveryIdentifier(sessionStorage, scope, requestId, base?.id ?? null); }
      catch { recoveryAvailable = false; setMessage("Browser storage is unavailable; reload recovery is not available."); }
      const result = await commandReferralNextAction(createClient(), requestId, leadId, base, command, payload);
      if (!alive.current) return;
      try { removeRecoveryIdentifier(sessionStorage, scope, requestId); } catch { /* A confirmed result remains confirmed even if storage is blocked. */ }
      setAction(result.action.status === "open" ? result.action : null); setEditor(null); if (command === "complete" || command === "supersede") setCompletion(null);
      setMessage(recoveryAvailable ? "Action saved." : "Action saved. Browser storage is unavailable; reload recovery is not available.");
      await load();
    } catch (failure) {
      const rejection = referralActionRejection(failure);
      if (rejection && attemptedRequestId) {
        try { removeRecoveryIdentifier(sessionStorage, scope, attemptedRequestId); } catch { /* Keep identifiers if browser storage cannot be updated. */ }
      }
      if (alive.current) setError(rejection ?? "Save not confirmed. Your draft is retained. Refresh to check current work and its history; if it changed, discard this draft after reviewing the current action before trying again.");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function edit(command: Editor["command"]) {
    setEditor({ command, base: action, terms: action ? { action_text: action.action_text, owner_id: action.owner_id, backup_id: action.backup_id, due_at: action.due_at, waiting_condition: action.waiting_condition, dependency_text: action.dependency_text } : { action_text: "", owner_id: "", backup_id: null, due_at: null, waiting_condition: null, dependency_text: null }, dueLocal: action?.due_at ? utcIsoToFacilityDatetimeLocal(action.due_at) : "", evidence: "" });
  }
  async function saveEditor() {
    if (!editor) return;
    try {
      const originalDueLocal = editor.base?.due_at ? utcIsoToFacilityDatetimeLocal(editor.base.due_at) : "";
      const dueAt = editor.dueLocal === originalDueLocal ? editor.base?.due_at ?? null : editor.dueLocal ? facilityDatetimeLocalToUtcIso(editor.dueLocal) : null;
      if (editor.dueLocal !== originalDueLocal && dueAt && utcIsoToFacilityDatetimeLocal(dueAt) !== editor.dueLocal) throw new Error("That local time does not exist in Eastern Time. Choose a valid due time.");
      const terms = { ...editor.terms, action_text: editor.terms.action_text.trim(), due_at: dueAt, waiting_condition: editor.terms.waiting_condition?.trim() || null, dependency_text: editor.terms.dependency_text?.trim() || null };
      if (!terms.action_text || !terms.owner_id || (!terms.due_at && !terms.waiting_condition)) throw new Error("Enter an action, owner, and due date or waiting condition.");
      if (terms.backup_id === terms.owner_id) throw new Error("Choose a different person as backup.");
      if (editor.command !== "create" && !editor.evidence.trim()) throw new Error("Record why this action is changing.");
      await run(editor.command, editor.command === "supersede" ? { replacement: terms, supersede_evidence: editor.evidence.trim() } : { ...terms, ...(editor.command === "update" ? { change_note: editor.evidence.trim() } : {}) }, editor.base);
    } catch (e) { setError(e instanceof Error ? e.message : "Review the action fields."); }
  }
  async function more(kind: "events" | "assignees") {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const current = generation.current;
    try {
      if (kind === "events") {
        const page = await listReferralNextActionEvents(createClient(), leadId, eventCursor);
        if (alive.current && current === generation.current) { setEvents((rows) => [...rows, ...page.items]); setEventCursor(page.next_cursor); }
      } else {
        const page = await listReferralNextActionAssignees(createClient(), facilityId, assigneeCursor);
        if (alive.current && current === generation.current) { setAssignees((rows) => [...rows, ...page.items]); setAssigneeCursor(page.next_cursor); }
      }
    } catch { if (alive.current) setError("More records could not be loaded. Try again."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function term(key: keyof NextActionTerms, value: string) { setEditor((old) => old && ({ ...old, terms: { ...old.terms, [key]: value || null } })); }
  return <section aria-label="Accountable next action" className="min-w-0 rounded-lg border border-border bg-card p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Accountable next action</h2><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void load()}>Refresh action</Button></div>
    {loading && <p role="status">Loading action…</p>}
    {error && <p role="alert" className="mt-3 text-foreground">{error}</p>}
    {message && <p role="status" className="mt-3">{message}</p>}
    {!loading && action && <div className="mt-4 space-y-2">
      <p className="whitespace-pre-wrap break-words font-medium">{action.action_text}</p>
      <p>Owner: {personLabel(action.owner_name, action.owner_id)} — {action.owner_eligible ? "Access active" : "Access unavailable"}; {action.owner_acknowledged ? "Acknowledged" : "Not acknowledged"}</p>
      {action.backup_id && <p>Backup: {personLabel(action.backup_name, action.backup_id)} — {action.backup_eligible ? "Access active" : "Access unavailable"}; {action.backup_accepted ? "Coverage accepted" : "Coverage not accepted"}</p>}
      {action.due_at && <p>Due: {dateLabel(action.due_at)}</p>}
      {action.waiting_condition && <p className="whitespace-pre-wrap break-words">Waiting for: {action.waiting_condition}</p>}
      {action.dependency_text && <p className="whitespace-pre-wrap break-words">Dependency: {action.dependency_text}</p>}
      <div className="flex flex-wrap gap-2">
        {action.can_acknowledge && <Button disabled={busy || !!editor} onClick={() => void run("acknowledge", { acknowledgment_note: null })}>Acknowledge my ownership</Button>}
        {action.can_accept_backup && <Button disabled={busy || !!editor} onClick={() => void run("accept_backup", { acceptance_note: null })}>Accept backup coverage</Button>}
        {action.can_manage && <><Button variant="outline" disabled={busy || !!editor} onClick={() => edit("update")}>Edit or reassign</Button><Button variant="outline" disabled={busy || !!editor} onClick={() => edit("supersede")}>Replace action</Button></>}
      </div>
      {action.can_complete && !editor && <div><label>Completion evidence<textarea aria-label="Completion evidence" className={inputClass} disabled={busy} value={completion?.text ?? ""} onChange={(e) => setCompletion((draft) => e.target.value ? { text: e.target.value, base: draft?.base ?? action } : null)} /></label><Button className="mt-2" disabled={busy || !completion?.text.trim()} onClick={() => completion && void run("complete", { completion_evidence: completion.text.trim() }, completion.base)}>Complete action</Button>{completion && <Button className="ml-2 mt-2" variant="outline" disabled={busy} onClick={() => setCompletion(null)}>Discard completion draft</Button>}{completion && (completion.base.id !== action.id || completion.base.version !== action.version) && <p className="mt-2">This completion draft refers to an earlier action version. Review current work before discarding and re-entering evidence; a stale completion cannot overwrite it.</p>}</div>}
    </div>}
    {!loading && !error && !action && !editor && <div className="mt-3"><p>No open action recorded.</p>{canManage && <Button className="mt-2" disabled={busy} onClick={() => edit("create")}>Add next action</Button>}</div>}
    {editor && <fieldset disabled={busy || loading} className="mt-4 min-w-0 space-y-3 border-t border-border pt-4"><legend className="font-medium">{editor.command === "create" ? "New action" : editor.command === "update" ? "Edit action" : "Replacement action"}</legend>
      <label className="block">Action<textarea aria-label="Action" className={inputClass} value={editor.terms.action_text ?? ""} onChange={(e) => term("action_text", e.target.value)} /></label>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(["owner_id", "backup_id"] as const).map((key) => <label key={key}>{key === "owner_id" ? "Owner" : "Backup (optional)"}<select aria-label={key === "owner_id" ? "Owner" : "Backup (optional)"} className={inputClass} value={editor.terms[key] ?? ""} onChange={(e) => term(key, e.target.value)}><option value="">{key === "owner_id" ? "Choose owner" : "No backup"}</option>{editor.terms[key] && !assignees.some((person) => person.id === editor.terms[key]) && <option value={editor.terms[key] ?? ""}>{personLabel(key === "owner_id" ? editor.base?.owner_name : editor.base?.backup_name, editor.terms[key])} (access not confirmed)</option>}{assignees.map((person) => <option key={person.id} value={person.id}>{assigneeLabel(person, assignees)}</option>)}</select></label>)}</div>
      {assigneeCursor && <Button variant="outline" onClick={() => void more("assignees")}>Load more eligible people</Button>}
      <label className="block">Due date and time (ET, optional with waiting condition)<input aria-label="Due date and time (ET, optional with waiting condition)" className={inputClass} type="datetime-local" value={editor.dueLocal} onChange={(e) => setEditor({ ...editor, dueLocal: e.target.value })} /></label>
      <label className="block">Waiting condition<textarea aria-label="Waiting condition" className={inputClass} value={editor.terms.waiting_condition ?? ""} onChange={(e) => term("waiting_condition", e.target.value)} /></label>
      <label className="block">Dependency (optional)<textarea aria-label="Dependency (optional)" className={inputClass} value={editor.terms.dependency_text ?? ""} onChange={(e) => term("dependency_text", e.target.value)} /></label>
      {editor.command !== "create" && <label className="block">{editor.command === "update" ? "Reason for change" : "Replacement evidence"}<textarea aria-label={editor.command === "update" ? "Reason for change" : "Replacement evidence"} className={inputClass} value={editor.evidence} onChange={(e) => setEditor({ ...editor, evidence: e.target.value })} /></label>}
      <p className="text-muted-foreground">Assignment does not acknowledge ownership or accept backup coverage. Changed terms require fresh acceptance.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => void saveEditor()}>Save action</Button><Button variant="outline" onClick={() => setEditor(null)}>Cancel edit</Button></div>
    </fieldset>}
    <details className="mt-4"><summary className="cursor-pointer font-medium">Action history</summary><ol className="mt-3 space-y-3">{events.map((event) => <li key={event.id} className="border-t border-border pt-2"><p>{event.command.replaceAll("_", " ")} — {personLabel(event.actor_name, event.actor_id)}, {dateLabel(event.created_at)}</p><p className="whitespace-pre-wrap break-words">{event.after_state.action_text}</p>{["change_note", "completion_evidence", "supersede_evidence", "acknowledgment_note", "acceptance_note"].map((key) => typeof event.payload[key] === "string" && event.payload[key] ? <p key={key} className="whitespace-pre-wrap break-words">{event.payload[key] as string}</p> : null)}<details className="mt-2"><summary className="cursor-pointer">View recorded terms</summary><p className="mt-2 text-xs text-muted-foreground">Identifiers preserve the recorded assignment. Names, where available, come from the current directory.</p><div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2"><RecordedTerms title="Before" state={event.before_state} people={assignees} /><RecordedTerms title="After" state={event.after_state} people={assignees} /></div>{event.command === "supersede" && <ReplacementTerms payload={event.payload.replacement} actionId={event.after_state.superseded_by_action_id} people={assignees} />}</details></li>)}</ol>{!loading && !error && !events.length && <p>No action history recorded.</p>}{eventCursor && <Button className="mt-3" variant="outline" disabled={busy || loading} onClick={() => void more("events")}>Load older history</Button>}</details>
  </section>;
}
