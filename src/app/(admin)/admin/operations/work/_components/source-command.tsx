"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { CONTROL, DateTimeInput } from "./work-inputs";

/**
 * Shared machinery for the typed source-record entry surfaces (COL-241,
 * COL-244). One place decides how a command is sent, how an unknown result is
 * retried and how a delivery verdict is stated, so no surface invents a
 * friendlier version of any of those.
 *
 * It sends the delivered commands and nothing else: no schedule, rule,
 * cadence, applicability or deadline, and no write outside the command.
 */

export const commandReplySchema = z.object({
  outcome: z.literal("record"),
  record: z.object({ id: databaseUuidSchema, record_version: z.number().int().min(1).optional(), finalized_at: z.string().nullable().optional(), voided_at: z.string().nullable().optional() }).passthrough(),
  delivery: z.unknown().nullable(),
  linked: z.boolean(),
  replayed: z.boolean(),
  link_reason: z.string().optional(),
});
export type CommandReply = z.infer<typeof commandReplySchema>;

export const LATE_ENTRY_LABEL = "Reason for a late entry or an entry on someone else's behalf (required by the rules for those cases)";

/** A local date and time that does not exist on the clock, refused rather than moved. */
export const IMPOSSIBLE_LOCAL_TIME_COPY =
  "That date and time does not exist in this site's time zone — the clocks move forward across it. Enter the time as the clock actually read. Nothing was recorded.";

/**
 * The database's own refusal reason for a delivery, read off the reply rather
 * than guessed. `link_reason` is only ever set when there is no delivery at
 * all, so an unlinked delivery carries its reason here and nowhere else.
 */
export function deliveryReason(delivery: unknown): { reason: string; detail: string | null } | null {
  if (!delivery || typeof delivery !== "object") return null;
  const event = (delivery as { event?: unknown }).event;
  if (!event || typeof event !== "object") return null;
  const { reason, detail } = event as { reason?: unknown; detail?: unknown };
  if (typeof reason !== "string" || reason.length === 0) return null;
  return { reason, detail: typeof detail === "string" && detail.length > 0 ? detail : null };
}

/**
 * What a delivered command actually proved, stated without widening it. An
 * unlinked record never claims the requirement was missing when the database
 * said something else — an unauthorised recorder is a found requirement that
 * this person did not satisfy, not an absent one.
 */
export function deliveryNotice(reply: CommandReply): string {
  const refusal = deliveryReason(reply.delivery);
  const why = reply.link_reason ?? (refusal ? `${refusal.reason}${refusal.detail ? ` — ${refusal.detail}` : ""}` : "no matching requirement was found for it");
  const linked = reply.linked
    ? "It satisfied its matching requirement once."
    : `It is recorded and retained, and it did not link: ${why}.`;
  const replay = reply.replayed ? " This was a replay of the same request, so nothing was recorded twice." : "";
  return `${linked}${replay} Any separate review, evidence or verification still applies.`;
}

/** One in-flight command, kept verbatim so an unknown result is retried as the same request rather than as a second one. */
export function useSourceCommand(disabled: boolean, onLockChange: (locked: boolean) => void, onSaved: (body: Record<string, unknown>) => void) {
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
  /** Refuse a submission before it is sent, saying why. A refused entry never fails silently. */
  const refuse = useCallback((message: string) => { setNotice(""); setError(message); }, []);
  return { pending, busy, error, notice, send, retry, refuse };
}

const assetSchema = z.object({ id: databaseUuidSchema, name: z.string(), asset_type: z.string(), asset_tag: z.string().nullable(), status: z.string() });
const assetListSchema = z.object({ assets: z.array(assetSchema) });
export type SiteAsset = z.infer<typeof assetSchema>;

/**
 * Current assets at one site, narrowed to the types the database accepts for a
 * kind. A retired asset cannot carry a current record, and an unavailable read
 * is never presented as an empty site.
 */
export function useSiteAssets(facilityId: string, assetTypes: readonly string[] | null) {
  const [assets, setAssets] = useState<SiteAsset[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const types = assetTypes ? assetTypes.join(",") : "";
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    void fetch(`/api/admin/operations/assets?facility_id=${encodeURIComponent(facilityId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Asset read failed");
        const reply = assetListSchema.parse(await response.json());
        if (version !== generation.current || controller.signal.aborted) return;
        const allowed = types ? types.split(",") : null;
        setAssets(reply.assets.filter((asset) => asset.status !== "retired" && (allowed === null || allowed.includes(asset.asset_type))));
        setError("");
      })
      .catch(() => {
        if (version !== generation.current || controller.signal.aborted) return;
        setAssets(null);
        setError("Site assets are unavailable under current access. No record can be made against an unknown asset.");
      });
    return () => controller.abort();
  }, [facilityId, types, attempt]);
  return { assets, error, reload: () => { setAssets(null); setAttempt((value) => value + 1); } };
}

export function assetLabel(asset: SiteAsset): string {
  return `${asset.name}${asset.asset_tag ? ` · ${asset.asset_tag}` : ""} · ${asset.asset_type.replaceAll("_", " ")}`;
}

export function describeAssetTypes(assetTypes: readonly string[] | null): string {
  if (!assetTypes || assetTypes.length === 0) return "site";
  return assetTypes.map((type) => type.replaceAll("_", " ")).join(" or ");
}

/**
 * A local date and time the person chose, sent as one instant.
 *
 * A nonexistent local time — the spring-forward hole — is refused, never
 * quietly moved: `fromZonedTime` maps 02:30 to an instant that reads back as
 * 01:30, so an unrefused entry would store an hour nobody chose. The
 * round-trip check is the same one `task-reminder.tsx` and `work-inputs.tsx`
 * already apply.
 */
export function instantFrom(localValue: string, timezone: string): string | null {
  try {
    const instant = fromZonedTime(localValue, timezone);
    if (Number.isNaN(instant.getTime())) return null;
    if (formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm") !== localValue) return null;
    return instant.toISOString();
  } catch {
    return null;
  }
}

/**
 * A staff-observed asset observation: the same form for the COL-154 generator,
 * carbon-monoxide and extinguisher checks and the COL-159 AED checks, because
 * they are one command with different kinds.
 */
export function ObservationForm({ observationKind, assetTypes, facilityId, timezone, disabled, onLockChange, onSaved }: { observationKind: string; assetTypes: readonly string[] | null; facilityId: string; timezone: string; disabled: boolean; onLockChange: (locked: boolean) => void; onSaved: (body: Record<string, unknown>) => void }) {
  const { assets, error: readError, reload } = useSiteAssets(facilityId, assetTypes);
  const [assetId, setAssetId] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");
  const [issue, setIssue] = useState("");
  const [note, setNote] = useState("");
  const [entryReason, setEntryReason] = useState("");
  const { pending, busy, error, notice, send, retry, refuse } = useSourceCommand(disabled, onLockChange, onSaved);
  function verify(reply: CommandReply) {
    if (!reply.record.id) throw new Error("Reply has no record");
  }
  function submit() {
    if (busy || pending || disabled || !assetId || !observedAt) return;
    const observedInstant = instantFrom(observedAt, timezone);
    if (!observedInstant) { refuse(IMPOSSIBLE_LOCAL_TIME_COPY); return; }
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
        <button type="button" className={CONTROL} disabled={busy || disabled} onClick={() => retry(verify, reload)}>Retry same observation</button>
      ) : (
        <button type="button" className={CONTROL} disabled={busy} onClick={reload}>Reload site assets</button>
      )}
      {assets === null ? (
        readError ? null : <p role="status">Loading site assets…</p>
      ) : assets.length === 0 ? (
        <p>No current {describeAssetTypes(assetTypes)} asset is available for this observation. Add the asset in the assets surface first; this surface does not create assets.</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <fieldset disabled={busy || pending !== null || disabled} className="space-y-3">
            <legend>Observation source command</legend>
            <label className="block">
              Asset observed
              <select className={CONTROL} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                <option value="">Choose the asset</option>
                {assets.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
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
              {LATE_ENTRY_LABEL}
              <textarea className={CONTROL} value={entryReason} onChange={(event) => setEntryReason(event.target.value)} />
            </label>
            <button className={CONTROL} disabled={!assetId || !observedAt || (outcome === "fail" && !issue.trim())}>Record this observation</button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
