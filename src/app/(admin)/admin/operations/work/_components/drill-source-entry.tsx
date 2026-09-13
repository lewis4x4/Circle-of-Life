"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { drillSourceComponent, drillSourceMap, type DrillSourceComponent } from "@/lib/operations/drill-source-map";
import { CONTROL, DateTimeInput } from "./work-inputs";

/**
 * COL-241: the staff entry surface for the COL-154 source commands.
 *
 * A drill written by the legacy emergency-preparedness form is a draft and
 * satisfies nothing until a person finalizes it here. An asset observation is
 * recorded final by the person who observed the work. This component only
 * calls the delivered commands — it writes no table itself, invents no rule,
 * day, time or deadline, and never presents a recorded log as a completed
 * review.
 */

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
const assetSchema = z.object({ id: databaseUuidSchema, name: z.string(), asset_type: z.string(), asset_tag: z.string().nullable(), status: z.string() });
const assetListSchema = z.object({ assets: z.array(assetSchema) });
const commandReplySchema = z.object({
  outcome: z.literal("record"),
  record: z.object({ id: databaseUuidSchema, record_version: z.number().int().min(1).optional(), finalized_at: z.string().nullable().optional(), voided_at: z.string().nullable().optional() }).passthrough(),
  delivery: z.unknown().nullable(),
  linked: z.boolean(),
  replayed: z.boolean(),
  link_reason: z.string().optional(),
});
type DrillLog = z.infer<typeof drillLogSchema>;
type CommandReply = z.infer<typeof commandReplySchema>;

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

/** What a delivered command actually proved, stated without widening it. */
function deliveryNotice(reply: CommandReply): string {
  const linked = reply.linked
    ? "It satisfied its matching requirement once."
    : `It is recorded and retained, and it did not link: ${reply.link_reason ?? "no matching requirement was found for it"}.`;
  const replay = reply.replayed ? " This was a replay of the same request, so nothing was recorded twice." : "";
  return `${linked}${replay} Any separate review, evidence or verification still applies.`;
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
                  {row.sourceId} · {row.label} · {row.kind.replaceAll("_", " ")} · {row.subjectKind ?? "Subject unknown"}: {row.command ? `${row.command.mode === "drill" ? "Drill log" : "Asset observation"} source record.` : "No source command."} {row.fallback}
                </li>
              ))}
            </ul>
          </details>
          {command.mode === "drill" ? (
            <DrillCommands drillType={command.drillType} taskId={taskId} facilityId={facilityId} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          ) : (
            <ObservationCommand observationKind={command.observationKind} assetType={command.assetType} facilityId={facilityId} timezone={timezone} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          )}
        </div>
      ) : null}
    </details>
  );
}

/** One in-flight command, kept verbatim so an unknown result is retried as the same request rather than as a second one. */
function useSourceCommand(disabled: boolean, onLockChange: (locked: boolean) => void, onSaved: (body: Record<string, unknown>) => void) {
  const [pending, setPending] = useState<{ url: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const sending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); onLockChange(false); };
  }, [onLockChange]);
  const send = useCallback(
    async (request: { url: string; body: string }, verify: (reply: CommandReply) => void, onRejected: () => void) => {
      if (sending.current || disabled) return;
      sending.current = true;
      onLockChange(true);
      setPending(request);
      setBusy(true);
      setError("");
      setNotice("");
      controller.current = new AbortController();
      try {
        const response = await fetch(request.url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: request.body, signal: controller.current.signal });
        if (!active.current) return;
        if (!response.ok) {
          if (response.status < 500 && ![408, 429].includes(response.status)) {
            const rejection = await response.json().catch(() => null);
            if (!active.current) return;
            setPending(null);
            onLockChange(false);
            onRejected();
            setError(`${typeof rejection?.error === "string" ? rejection.error : "The record was rejected"}. Nothing was recorded. Re-read the current records before another attempt.`);
            return;
          }
          throw new Error("Unknown result");
        }
        const reply = commandReplySchema.parse(await response.json());
        verify(reply);
        if (!active.current) return;
        setPending(null);
        onLockChange(false);
        setNotice(deliveryNotice(reply));
        onSaved(reply as unknown as Record<string, unknown>);
      } catch {
        if (active.current) setError("The result of this record is unknown. Retry the same request before recording anything else; do not record it a second time.");
      } finally {
        sending.current = false;
        if (active.current) setBusy(false);
      }
    },
    [disabled, onLockChange, onSaved],
  );
  const retry = useCallback((verify: (reply: CommandReply) => void, onRejected: () => void) => { if (pending) void send(pending, verify, onRejected); }, [pending, send]);
  return { pending, busy, error, notice, send, retry, setError };
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
                Reason for a late entry or an entry on someone else&apos;s behalf (required by the rules for those cases)
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

function ObservationCommand({ observationKind, assetType, facilityId, timezone, disabled, onLockChange, onSaved }: { observationKind: string; assetType: string | null; facilityId: string; timezone: string; disabled: boolean; onLockChange: (locked: boolean) => void; onSaved: (body: Record<string, unknown>) => void }) {
  const [assets, setAssets] = useState<z.infer<typeof assetSchema>[] | null>(null);
  const [readError, setReadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [assetId, setAssetId] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");
  const [issue, setIssue] = useState("");
  const [note, setNote] = useState("");
  const [entryReason, setEntryReason] = useState("");
  const { pending, busy, error, notice, send, retry } = useSourceCommand(disabled, onLockChange, onSaved);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    void fetch(`/api/admin/operations/assets?facility_id=${encodeURIComponent(facilityId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Asset read failed");
        const reply = assetListSchema.parse(await response.json());
        if (version === generation.current && !controller.signal.aborted) {
          // A retired asset cannot carry a current observation, and the database enforces the asset type for the kinds that have one.
          setAssets(reply.assets.filter((asset) => asset.status !== "retired" && (assetType === null || asset.asset_type === assetType)));
          setReadError("");
        }
      })
      .catch(() => {
        if (version === generation.current && !controller.signal.aborted) {
          setAssets(null);
          setAssetId("");
          setReadError("Site assets are unavailable under current access. No observation can be recorded against an unknown asset.");
        }
      });
    return () => controller.abort();
  }, [facilityId, assetType, attempt]);
  function reload() { setAssets(null); setAttempt((value) => value + 1); }
  function verify(reply: CommandReply) {
    if (reply.record.id.length === 0) throw new Error("Reply has no record");
  }
  function submit() {
    if (busy || pending || disabled || !assetId || !observedAt) return;
    let observedInstant: string;
    try {
      observedInstant = fromZonedTime(observedAt, timezone).toISOString();
    } catch {
      return;
    }
    const body = {
      request_key: crypto.randomUUID(),
      payload: {
        facility_id: facilityId,
        asset_id: assetId,
        observation_kind: observationKind,
        // Only a person's own observation is accepted; the database refuses the other bases by name.
        basis: "staff_observed",
        observed_at: observedInstant,
        outcome,
        ...(outcome === "fail" ? { issue_summary: issue.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(entryReason.trim() ? { entry_reason: entryReason.trim() } : {}),
      },
    };
    void send({ url: "/api/admin/operations/asset-observations", body: JSON.stringify(body) }, verify, reload);
  }
  return (
    <div className="space-y-3">
      <p>
        Only an observation a person made is accepted. An automatic self-test, a controller log or a photograph is not an observation, and this record does not change the asset&apos;s approved service dates.
      </p>
      {readError ? <p role="alert">{readError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">Recording…</p> : null}
      {pending ? (
        <button type="button" className={CONTROL} disabled={busy || disabled} onClick={() => retry(verify, reload)}>
          Retry same observation
        </button>
      ) : (
        <button type="button" className={CONTROL} disabled={busy} onClick={reload}>
          Reload site assets
        </button>
      )}
      {assets === null ? (
        readError ? null : <p role="status">Loading site assets…</p>
      ) : assets.length === 0 ? (
        <p>No current {assetType ? assetType.replaceAll("_", " ") : "site"} asset is available for this observation. Add the asset in the assets surface first; this surface does not create assets.</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <fieldset disabled={busy || pending !== null || disabled} className="space-y-3">
            <legend>Observation source command</legend>
            <label className="block">
              Asset observed
              <select className={CONTROL} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                <option value="">Choose the asset</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                    {asset.asset_tag ? ` · ${asset.asset_tag}` : ""} · {asset.asset_type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <DateTimeInput id={`observed-${observationKind}`} label="When you observed it" value={observedAt} onChange={setObservedAt} required timezone={timezone} />
            <label className="block">
              Observed outcome
              <select className={CONTROL} value={outcome} onChange={(event) => setOutcome(event.target.value as "pass" | "fail")}>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </select>
            </label>
            {outcome === "fail" ? (
              <label className="block">
                What failed (required). Recording a failure keeps its follow-up open; it does not close the problem.
                <textarea className={CONTROL} required value={issue} onChange={(event) => setIssue(event.target.value)} />
              </label>
            ) : null}
            <label className="block">
              Note
              <textarea className={CONTROL} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <label className="block">
              Reason for a late entry or an entry on someone else&apos;s behalf (required by the rules for those cases)
              <textarea className={CONTROL} value={entryReason} onChange={(event) => setEntryReason(event.target.value)} />
            </label>
            <button className={CONTROL} disabled={!assetId || !observedAt || (outcome === "fail" && !issue.trim())}>
              Record this observation
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
