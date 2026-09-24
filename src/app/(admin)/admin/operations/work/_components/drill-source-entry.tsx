"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { drillSourceComponent, drillSourceMap, type DrillSourceComponent } from "@/lib/operations/drill-source-map";
import { CONTROL } from "./work-inputs";
import { LATE_ENTRY_LABEL, ObservationForm, useSourceCommand, type CommandReply } from "./source-command";
import { enumLabel } from "@/lib/display/enum-label";

const drillLogSchema = z
  .object({
    id: databaseUuidSchema,
    drill_type: z.string(),
    drill_date: z.string(),
    drill_time: z.string(),
    outcome: z.string(),
    issue_summary: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    entry_reason: z.string().nullable().optional(),
    conducted_by: databaseUuidSchema.nullable().optional(),
    record_version: z.number().int().min(1),
    finalized_at: z.string().nullable(),
    voided_at: z.string().nullable(),
  })
  .passthrough();
const drillListSchema = z.object({ drill_logs: z.array(drillLogSchema), total: z.number().int().min(0), drill_type: z.string().nullable(), state: z.string().nullable() });
type DrillLog = z.infer<typeof drillLogSchema>;

type Props = {
  taskId: string;
  activityKey: string | null | undefined;
  actorId: string;
  actorName: string | null;
  facilityId: string;
  timezone: string;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
  onSaved: (body: Record<string, unknown>) => void;
};

export function DrillSourceEntry(props: Props) {
  const component = drillSourceComponent(props.activityKey);
  if (!component) return null;
  return <Entry key={`${props.taskId}:${props.activityKey}:${props.actorId}:${props.facilityId}`} component={component} {...props} />;
}

function Entry({ component, taskId, actorId, actorName, facilityId, timezone, disabled, onLockChange, onSaved }: Props & { component: DrillSourceComponent }) {
  const [opened, setOpened] = useState(false);
  const command = component.command!;
  return (
    <details onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary className={`${CONTROL} cursor-pointer`}>{command.mode === "drill" ? "Drill source record" : "Observation source record"}</summary>
      {opened ? (
        <div role="group" aria-label={command.mode === "drill" ? "Drill source record" : "Observation source record"} className="space-y-3 pt-3">
          <p>
            {component.sourceId} · {component.label}. Recorded by {actorName ?? actorId}. {component.fallback}
          </p>
          <details>
            <summary className={`${CONTROL} cursor-pointer`}>All drill, generator and extinguisher components</summary>
            <ul>
              {drillSourceMap.map((row) => (
                <li key={row.key}>
                  {row.sourceId} · {row.label} · {enumLabel(row.kind, { case: "lower" })} · {row.subjectKind ?? "Subject unknown"}: {row.command ? `${row.command.mode === "drill" ? "Drill log" : "Asset observation"} source record.` : "No source command."} {row.fallback}
                </li>
              ))}
            </ul>
          </details>
          {command.mode === "drill" ? (
            <DrillCommands drillType={command.drillType} taskId={taskId} facilityId={facilityId} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          ) : (
            <ObservationForm observationKind={command.observationKind} assetTypes={command.assetType ? [command.assetType] : null} facilityId={facilityId} timezone={timezone} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          )}
        </div>
      ) : null}
    </details>
  );
}

function DrillCommands({ drillType, taskId, facilityId, disabled, onLockChange, onSaved }: { drillType: "fire" | "elopement"; taskId: string; facilityId: string; disabled: boolean; onLockChange: (locked: boolean) => void; onSaved: (body: Record<string, unknown>) => void }) {
  const [logs, setLogs] = useState<DrillLog[] | null>(null);
  const [readError, setReadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("");
  const [entryReason, setEntryReason] = useState("");
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"finalize" | "correct" | "void">("finalize");
  const { pending, busy, error, notice, send, retry } = useSourceCommand(disabled, onLockChange, onSaved);
  const read = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    read.current = controller;
    const version = ++generation.current;
    const query = new URLSearchParams({ facility_id: facilityId, drill_type: drillType });
    void fetch(`/api/admin/operations/drill-logs?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Drill read failed");
        const reply = drillListSchema.parse(await response.json());
        if (reply.drill_type !== drillType || reply.drill_logs.length !== reply.total || reply.drill_logs.some((log) => log.drill_type !== drillType)) throw new Error("Mismatched drill reply");
        if (version === generation.current && !controller.signal.aborted) { setLogs(reply.drill_logs); setReadError(""); }
      })
      .catch(() => {
        if (version === generation.current && !controller.signal.aborted) {
          setLogs(null);
          setSelected("");
          setReadError("Drill records are unavailable under current access. Unavailable does not mean no drill was recorded, and it does not mean this requirement is satisfied.");
        }
      });
    return () => controller.abort();
  }, [facilityId, drillType, attempt]);
  const drafts = (logs ?? []).filter((log) => !log.finalized_at && !log.voided_at);
  const finals = (logs ?? []).filter((log) => log.finalized_at && !log.voided_at);
  const choices = action === "finalize" ? drafts : finals;
  const chosen = choices.find((log) => log.id === selected);
  function reload() { setSelected(""); setLogs(null); setAttempt((value) => value + 1); }
  function verify(reply: CommandReply) {
    const record = reply.record;
    if (record.id !== selected) throw new Error("Reply is for another drill record");
    if (action === "finalize" && !record.finalized_at) throw new Error("Reply does not show a final drill record");
    if (action === "void" && !record.voided_at) throw new Error("Reply does not show a voided drill record");
    if (action === "correct" && chosen && record.record_version !== undefined && record.record_version <= chosen.record_version) throw new Error("Reply does not show a new drill version");
  }
  function submit() {
    if (!chosen || busy || pending || disabled) return;
    const request_key = crypto.randomUUID();
    const body =
      action === "finalize"
        ? { request_key, action: "finalize" as const, payload: entryReason.trim() ? { entry_reason: entryReason.trim() } : {} }
        : action === "void"
          ? { request_key, action: "void" as const, payload: { reason: reason.trim() } }
          : { request_key, action: "correct" as const, expected_version: chosen.record_version, payload: { reason: reason.trim() } };
    void send({ url: `/api/admin/operations/drill-logs/${chosen.id}`, body: JSON.stringify(body) }, verify, reload);
  }
  return (
    <div className="space-y-3">
      <p>
        A drill saved on the emergency preparedness page is a <strong>draft</strong>: it satisfies nothing until a person finalizes it here. Finalizing records who finalized it and delivers the record once. A correction restates a final record as a new version; a void reverses it into retained history.
      </p>
      {readError ? <p role="alert">{readError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">Recording…</p> : null}
      {pending ? (
        <button type="button" className={CONTROL} disabled={busy || disabled} onClick={() => retry(verify, reload)}>
          Retry same drill command
        </button>
      ) : (
        <button type="button" className={CONTROL} disabled={busy} onClick={reload}>
          Reload drill records
        </button>
      )}
      {logs === null ? (
        readError ? null : <p role="status">Loading drill records…</p>
      ) : (
        <form
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <fieldset disabled={busy || pending !== null || disabled} className="space-y-3">
            <legend>Drill source command · task {taskId.slice(0, 8)}</legend>
            <label className="block">
              Command
              <select className={CONTROL} value={action} onChange={(event) => { setAction(event.target.value as typeof action); setSelected(""); setReason(""); }}>
                <option value="finalize">Finalize a draft drill record</option>
                <option value="correct">Correct a final drill record</option>
                <option value="void">Void a final drill record</option>
              </select>
            </label>
            {choices.length === 0 ? (
              <p>
                {action === "finalize"
                  ? `No draft ${drillType} drill record is available at this site. Record the drill on the emergency preparedness page first; this surface does not create drill records.`
                  : `No final ${drillType} drill record is available to change.`}
              </p>
            ) : (
              <ul>
                {choices.map((log) => (
                  <li key={log.id}>
                    <label>
                      <input type="radio" name={`drill-${taskId}`} value={log.id} checked={selected === log.id} onChange={() => setSelected(log.id)} /> {log.drill_date} {log.drill_time.slice(0, 5)} · {log.drill_type} · recorded outcome {log.outcome} · version {log.record_version}
                    </label>
                    {log.outcome === "failed" ? <p>This drill is recorded as failed. Finalizing it keeps its follow-up open; it does not close the problem.</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {action === "finalize" ? (
              <label className="block">
                {LATE_ENTRY_LABEL}
                <textarea className={CONTROL} value={entryReason} onChange={(event) => setEntryReason(event.target.value)} />
              </label>
            ) : (
              <label className="block">
                Reason for this {action === "void" ? "void" : "correction"} (required)
                <textarea className={CONTROL} required value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
            )}
            <button className={CONTROL} disabled={!chosen || (action !== "finalize" && !reason.trim())}>
              {action === "finalize" ? "Finalize this drill record" : action === "correct" ? "Record a correction" : "Void this drill record"}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
