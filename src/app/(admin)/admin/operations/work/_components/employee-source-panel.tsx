"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { employeeSourceMap } from "@/lib/operations/employee-source-map";
import { CONTROL } from "./work-inputs";
import { enumLabel } from "@/lib/display/enum-label";
const replySchema = z.object({
  task_id: databaseUuidSchema, employee_id: databaseUuidSchema.nullable(), activity_key: z.string(), as_of: z.string(),
  availability: z.enum(["available", "unavailable"]), reason: z.string().nullable(), can_open_employee_file: z.boolean(), can_medical: z.boolean(), source_version: z.string().nullable(),
  fields: z.array(z.object({ source_id: z.string(), component_key: z.string(), label: z.string(), kind: z.string(), state: z.string(), requirement_codes: z.array(z.string()), value: z.string().nullable(), reason: z.string(), records: z.array(z.object({ record_id: databaseUuidSchema, requirement_id: databaseUuidSchema, requirement_version: z.number().int(), status: z.string(), completed_on: z.string().nullable(), expires_on: z.string().nullable() })) })),
  assessment_scope: z.enum(["visible_records_only", "unavailable"]), history: z.array(z.object({ id: databaseUuidSchema, observed_at: z.string(), source_version: z.string(), changed: z.boolean() })), complete: z.boolean(),
});
type Props = { taskId: string; activityKey: string | null | undefined; actorId: string; facilityId: string; subjectId: string | null };
export function EmployeeSourcePanel(props: Props) {
  if (!employeeSourceMap.some(row => row.key === props.activityKey)) return null;
  return <Panel key={`${props.taskId}:${props.activityKey}:${props.actorId}:${props.facilityId}:${props.subjectId}`} {...props} />;
}
function Panel({ taskId, activityKey }: Props) {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<z.infer<typeof replySchema> | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  const sending = useRef(false);
  const command = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; command.current?.abort(); read.current?.abort(); }; }, []);
  const validate = useCallback((raw: unknown) => {
    const reply = replySchema.parse(raw);
    const keys = reply.fields.map(field => field.component_key);
    if (reply.task_id !== taskId || reply.activity_key !== activityKey || !reply.complete || keys.length !== employeeSourceMap.length || new Set(keys).size !== keys.length || employeeSourceMap.some(row => !keys.includes(row.key))) throw new Error("Incomplete or mismatched source reply");
    return reply;
  }, [taskId, activityKey]);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController(); read.current = controller; const version = ++generation.current;
    void fetch(`/api/admin/operations/employee-sources?${new URLSearchParams({ task_id: taskId })}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Source read failed"); const reply = validate(await response.json());
      if (active.current && !controller.signal.aborted && version === generation.current) setData(reply);
    }).catch(() => { if (active.current && !controller.signal.aborted && version === generation.current) { setData(null); setError("Employee source details unavailable. Earlier results are not current proof; no missing-record conclusion can be drawn."); } });
    return () => controller.abort();
  }, [opened, attempt, taskId, activityKey, validate]);
  async function reconcile(body: string) {
    if (sending.current) return;
    sending.current = true; read.current?.abort(); generation.current++; setBusy(true); setPending(body); setData(null); setError(""); command.current = new AbortController();
    try {
      const response = await fetch("/api/admin/operations/employee-sources/reconcile", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, signal: command.current.signal });
      if (!active.current) return;
      if (!response.ok) {
        if (response.status < 500 && ![408,429].includes(response.status)) { setPending(null); setError("Refresh rejected. Current employee access must be checked before another attempt."); return; }
        throw new Error("Unknown refresh result");
      }
      const reply = validate(await response.json()); if (!active.current) return;
      setPending(null); setData(reply);
    } catch { if (active.current) { setData(null); setError("Refresh result unknown. Retry the same refresh to check its recorded outcome."); } }
    finally { sending.current = false; if (active.current) setBusy(false); }
  }
  const visible = data?.availability === "available" && data.assessment_scope === "visible_records_only";
  return <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className={`${CONTROL} cursor-pointer`}>Employee File source context</summary>
    {opened ? <div role="group" aria-label="Employee File source context" className="space-y-3 pt-3">
      <p>Existing Employee File records only. Refresh records source changes; it does not complete this task, grant specialized work access, or take employment action.</p>
      <details><summary className={`${CONTROL} cursor-pointer`}>All 20 source items and 22 components</summary><ul>{employeeSourceMap.map(row => <li key={row.key}>{row.sourceId} · {row.label} · {enumLabel(row.kind, { case: "lower" })}. {row.gap ?? "Approved native source records only."}</li>)}</ul></details>
      {error ? <p role="alert">{error}</p> : null}
      {busy ? <p role="status">Checking employee sources…</p> : null}
      {pending ? <button type="button" className={CONTROL} disabled={busy} onClick={() => void reconcile(pending)}>Retry same employee source refresh</button> : <>
        <button type="button" className={CONTROL} onClick={() => { setData(null); setError(""); setAttempt(value => value + 1); }}>Reload employee sources</button>
        {data ? <button type="button" className={CONTROL} onClick={() => void reconcile(JSON.stringify({ task_id: taskId, request_key: crypto.randomUUID() }))}>Refresh and record source changes</button> : null}
      </>}
      {data ? <>
        <p>{data.reason ?? "Assessment includes only records visible under current access."} It is not proof that the complete file or training program is satisfied.</p>
        {visible && data.can_open_employee_file && data.employee_id ? <a className={CONTROL} href={`/admin/staff/${data.employee_id}/employee-file`}>Open existing Employee File</a> : null}
        <ul className="space-y-3">{data.fields.map(field => {
          const map = employeeSourceMap.find(row => row.key === field.component_key)!;
          const protectedField = !visible || field.state === "unavailable" || (map.medical && !data.can_medical);
          return <li key={field.component_key}><p className="font-medium">{map.sourceId} · {map.label}</p>{protectedField ? <p>Unavailable under current access. Protected values and dates are not shown.</p> : <>
            <p>Recorded source state: {enumLabel(field.state, { case: "lower" })}{field.value ? ` · ${field.value}` : ""}</p><p>{field.reason}</p>
            <ul>{field.records.map(record => <li key={record.record_id}>Requirement version {record.requirement_version} · {record.status} · Completed: {record.completed_on ?? "Unknown"} · Expires: {record.expires_on ?? "Unknown"}</li>)}</ul>
          </>}</li>;
        })}</ul>
        {visible ? <details><summary className={`${CONTROL} cursor-pointer`}>Recorded source changes</summary><ul>{data.history.map(event => <li key={event.id}>{event.observed_at} · {event.changed ? "Source changed" : "Source checked"} · Version {event.source_version.slice(0,12)}</li>)}</ul></details> : null}
      </> : null}
    </div> : null}
  </details>;
}
