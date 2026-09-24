"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { dietaryServiceComponent, dietaryServiceSourceMap, type DietaryServiceComponent } from "@/lib/operations/dietary-service-source-map";
import { MEAL_PERIODS } from "@/lib/operations/source-records";
import { CONTROL, DateTimeInput } from "./work-inputs";
import { LATE_ENTRY_LABEL, ObservationForm, assetLabel, describeAssetTypes, localTimeRefusal, resolveLocalInstant, useSiteAssets, useSourceCommand, type CommandReply } from "./source-command";
import { enumLabel } from "@/lib/display/enum-label";

/**
 * COL-244: the staff entry surface for the COL-159 source commands — dietary
 * records, facility and asset service records, and the two AED observations.
 *
 * It calls the delivered commands only. It writes no table itself, sets no
 * rule, threshold, reading definition, equipment list or deadline, sends or
 * publishes nothing, creates no vendor and never changes an asset's approved
 * service dates, a building profile date, the licence expiry, a vault document
 * or a maintenance ticket. The ten COL-159 components dispositioned as human
 * recording or review get no screen here.
 */

const vendorSchema = z.object({ id: databaseUuidSchema, name: z.string(), status: z.string().optional() });
const vendorListSchema = z.object({ vendors: z.array(vendorSchema) });

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

export function DietaryServiceEntry(props: Props) {
  const component = dietaryServiceComponent(props.activityKey);
  if (!component) return null;
  return <Entry key={`${props.taskId}:${props.activityKey}:${props.actorId}:${props.facilityId}`} component={component} {...props} />;
}

const SUMMARY: Record<string, string> = {
  observation: "Observation source record",
  "asset-service": "Service source record",
  "facility-service": "Service source record",
  dietary: "Dietary source record",
};

function Entry({ component, facilityId, actorId, actorName, timezone, disabled, onLockChange, onSaved }: Props & { component: DietaryServiceComponent }) {
  const [opened, setOpened] = useState(false);
  const command = component.command!;
  const summary = SUMMARY[command.mode];
  return (
    <details onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary className={`${CONTROL} cursor-pointer`}>{summary}</summary>
      {opened ? (
        <div role="group" aria-label={summary} className="space-y-3 pt-3">
          <p>
            {component.sourceId} · {component.label}. Recorded by {actorName ?? actorId}. {component.fallback}
          </p>
          <details>
            <summary className={`${CONTROL} cursor-pointer`}>All dietary, facility service and administration components</summary>
            <ul>
              {dietaryServiceSourceMap.map((row) => (
                <li key={row.key}>
                  {row.sourceId} · {row.label} · {enumLabel(row.kind, { case: "lower" })} · {row.subjectKind ?? "Subject unknown"}: {row.command ? `${row.command.mode.replaceAll("-", " ")} source record.` : "No source command here."} {row.fallback}
                </li>
              ))}
            </ul>
          </details>
          {command.mode === "observation" ? (
            <ObservationForm observationKind={command.kind} assetTypes={command.assetTypes} facilityId={facilityId} timezone={timezone} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          ) : command.mode === "dietary" ? (
            <DietaryForm recordKind={command.kind} facilityId={facilityId} timezone={timezone} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          ) : (
            <ServiceForm serviceKind={command.kind} assetTypes={command.mode === "asset-service" ? command.assetTypes : null} facilityId={facilityId} timezone={timezone} disabled={disabled} onLockChange={onLockChange} onSaved={onSaved} />
          )}
        </div>
      ) : null}
    </details>
  );
}

/** Vendors linked to this site, because a vendor performer must be one the organisation already has here. */
function useSiteVendors(facilityId: string, needed: boolean) {
  const [vendors, setVendors] = useState<z.infer<typeof vendorSchema>[] | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    const version = ++generation.current;
    void fetch(`/api/admin/operations/vendors?facility_id=${encodeURIComponent(facilityId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Vendor read failed");
        const reply = vendorListSchema.parse(await response.json());
        if (version !== generation.current || controller.signal.aborted) return;
        setVendors(reply.vendors);
        setError("");
      })
      .catch(() => {
        if (version !== generation.current || controller.signal.aborted) return;
        setVendors(null);
        setError("Site vendors are unavailable under current access. A vendor performer cannot be named from a label alone.");
      });
    return () => controller.abort();
  }, [facilityId, needed]);
  return { vendors, error };
}

function ServiceForm({ serviceKind, assetTypes, facilityId, timezone, disabled, onLockChange, onSaved }: { serviceKind: string; assetTypes: readonly string[] | null; facilityId: string; timezone: string; disabled: boolean; onLockChange: (locked: boolean) => void; onSaved: (body: Record<string, unknown>) => void }) {
  const needsAsset = assetTypes !== null;
  const { assets, error: assetError, reload } = useSiteAssets(facilityId, assetTypes);
  const [assetId, setAssetId] = useState("");
  const [performedAt, setPerformedAt] = useState("");
  const [performerKind, setPerformerKind] = useState<"staff" | "vendor">("staff");
  const [vendorId, setVendorId] = useState("");
  const [performerLabel, setPerformerLabel] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");
  const [issue, setIssue] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [note, setNote] = useState("");
  const [entryReason, setEntryReason] = useState("");
  const { vendors, error: vendorError } = useSiteVendors(facilityId, performerKind === "vendor");
  const { pending, busy, error, notice, send, retry, refuse } = useSourceCommand(disabled, onLockChange, onSaved);
  function verify(reply: CommandReply) {
    if (!reply.record.id) throw new Error("Reply has no record");
  }
  const ready = Boolean(performedAt) && (!needsAsset || Boolean(assetId)) && (performerKind === "staff" || Boolean(vendorId)) && (outcome === "pass" || Boolean(issue.trim()));
  function submit() {
    if (busy || pending || disabled || !ready) return;
    const resolved = resolveLocalInstant(performedAt, timezone);
    if (!("instant" in resolved)) { refuse(localTimeRefusal(resolved.problem)); return; }
    const performedInstant = resolved.instant;
    const body = {
      request_key: crypto.randomUUID(),
      payload: {
        facility_id: facilityId,
        service_kind: serviceKind,
        ...(needsAsset ? { asset_id: assetId } : {}),
        performed_at: performedInstant,
        performer_kind: performerKind,
        // A staff performer defaults to the recorder in the database; a vendor must be a site-linked vendor row.
        ...(performerKind === "vendor" ? { vendor_id: vendorId, ...(performerLabel.trim() ? { performer_label: performerLabel.trim() } : {}) } : {}),
        outcome,
        ...(outcome === "fail" ? { issue_summary: issue.trim() } : {}),
        ...(nextDue ? { next_due_on: nextDue } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(entryReason.trim() ? { entry_reason: entryReason.trim() } : {}),
      },
    };
    void send({ url: "/api/admin/operations/service-records", body: JSON.stringify(body) }, verify, reload);
  }
  return (
    <div className="space-y-3">
      <p>
        One service on one occasion. The kind cannot be changed afterwards — a record made under the wrong kind is voided and recorded again. This record does not change the asset&apos;s approved next service date, the building profile, the licence expiry, a vault document or a maintenance ticket.
      </p>
      {assetError && needsAsset ? <p role="alert">{assetError}</p> : null}
      {vendorError ? <p role="alert">{vendorError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">Recording…</p> : null}
      {pending ? (
        <button type="button" className={CONTROL} disabled={busy || disabled} onClick={() => retry(verify, reload)}>Retry same service record</button>
      ) : needsAsset ? (
        <button type="button" className={CONTROL} disabled={busy} onClick={reload}>Reload site assets</button>
      ) : null}
      {needsAsset && assets === null ? (
        assetError ? null : <p role="status">Loading site assets…</p>
      ) : needsAsset && assets!.length === 0 ? (
        <p>No current {describeAssetTypes(assetTypes)} asset is available for this service. Add the asset in the assets surface first; this surface does not create assets.</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <fieldset disabled={busy || pending !== null || disabled} className="space-y-3">
            <legend>Service source command · {enumLabel(serviceKind, { case: "lower" })}</legend>
            {needsAsset ? (
              <label className="block">
                Asset serviced
                <select className={CONTROL} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                  <option value="">Choose the asset</option>
                  {assets!.map((asset) => <option key={asset.id} value={asset.id}>{assetLabel(asset)}</option>)}
                </select>
              </label>
            ) : (
              <p>Recorded against this site. One vendor visit covering separate inspections is separate records, one for each.</p>
            )}
            <DateTimeInput id={`service-${serviceKind}`} label="When the service was performed" value={performedAt} onChange={setPerformedAt} required timezone={timezone} />
            <label className="block">
              Who performed it
              <select className={CONTROL} value={performerKind} onChange={(event) => { setPerformerKind(event.target.value as "staff" | "vendor"); setVendorId(""); setPerformerLabel(""); }}>
                <option value="staff">A staff member at this site</option>
                <option value="vendor">A vendor linked to this site</option>
              </select>
            </label>
            {performerKind === "vendor" ? (
              <>
                <label className="block">
                  Vendor
                  <select className={CONTROL} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
                    <option value="">Choose the vendor</option>
                    {(vendors ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                  </select>
                </label>
                {vendors !== null && vendors.length === 0 ? <p>No vendor is linked to this site. Link the vendor first; naming one here does not create it.</p> : null}
                <label className="block">
                  Technician name as stated (optional)
                  <input className={CONTROL} value={performerLabel} onChange={(event) => setPerformerLabel(event.target.value)} />
                </label>
              </>
            ) : null}
            <label className="block">
              Outcome
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
              Next due date stated on this service (optional). It is recorded on this record only and does not change the asset&apos;s approved schedule.
              <input className={CONTROL} type="date" value={nextDue} onChange={(event) => setNextDue(event.target.value)} />
            </label>
            <label className="block">
              Note
              <textarea className={CONTROL} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <label className="block">
              {LATE_ENTRY_LABEL}
              <textarea className={CONTROL} value={entryReason} onChange={(event) => setEntryReason(event.target.value)} />
            </label>
            <button className={CONTROL} disabled={!ready}>Record this service</button>
          </fieldset>
        </form>
      )}
    </div>
  );
}

const MEAL_PERIOD_LABELS: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack_am: "Morning snack", snack_pm: "Afternoon snack", snack_hs: "Bedtime snack" };

function DietaryForm({ recordKind, facilityId, timezone, disabled, onLockChange, onSaved }: { recordKind: "meal_substitution" | "menu_approval" | "emergency_food_supply_check"; facilityId: string; timezone: string; disabled: boolean; onLockChange: (locked: boolean) => void; onSaved: (body: Record<string, unknown>) => void }) {
  const [performedAt, setPerformedAt] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [mealPeriod, setMealPeriod] = useState("");
  const [plannedItem, setPlannedItem] = useState("");
  const [substituteItem, setSubstituteItem] = useState("");
  const [substitutionReason, setSubstitutionReason] = useState("");
  const [menuLabel, setMenuLabel] = useState("");
  const [approverLabel, setApproverLabel] = useState("");
  const [outcome, setOutcome] = useState<"performed" | "failed">("performed");
  const [issue, setIssue] = useState("");
  const [note, setNote] = useState("");
  const [entryReason, setEntryReason] = useState("");
  const { pending, busy, error, notice, send, retry, refuse } = useSourceCommand(disabled, onLockChange, onSaved);
  function verify(reply: CommandReply) {
    if (!reply.record.id) throw new Error("Reply has no record");
  }
  const substitutionReady = Boolean(serviceDate && mealPeriod && plannedItem.trim() && substituteItem.trim() && substitutionReason.trim());
  const approvalReady = Boolean(menuLabel.trim() && approverLabel.trim());
  const checkReady = outcome === "performed" || Boolean(issue.trim());
  const ready = Boolean(performedAt) && (recordKind === "meal_substitution" ? substitutionReady : recordKind === "menu_approval" ? approvalReady : checkReady);
  function submit() {
    if (busy || pending || disabled || !ready) return;
    const resolved = resolveLocalInstant(performedAt, timezone);
    if (!("instant" in resolved)) { refuse(localTimeRefusal(resolved.problem)); return; }
    const performedInstant = resolved.instant;
    const payload: Record<string, unknown> = { facility_id: facilityId, record_kind: recordKind, performed_at: performedInstant };
    if (recordKind === "meal_substitution") {
      // Meal level: the served date and period, both items and the reason. A problem is stated as an issue, never as a failed substitution.
      Object.assign(payload, { service_date: serviceDate, meal_period: mealPeriod, planned_item: plannedItem.trim(), substitute_item: substituteItem.trim(), substitution_reason: substitutionReason.trim() });
    } else if (recordKind === "menu_approval") {
      // The approver's name is recorded as stated; it is not a claim that this system verified their credential.
      Object.assign(payload, { menu_label: menuLabel.trim(), approver_label: approverLabel.trim() });
    } else {
      Object.assign(payload, { outcome, ...(outcome === "failed" ? { issue_summary: issue.trim() } : {}) });
    }
    if (note.trim()) payload.note = note.trim();
    if (entryReason.trim()) payload.entry_reason = entryReason.trim();
    void send({ url: "/api/admin/operations/dietary-records", body: JSON.stringify({ request_key: crypto.randomUUID(), payload }) }, verify, () => {});
  }
  return (
    <div className="space-y-3">
      <p>
        {recordKind === "meal_substitution"
          ? "One substitution for one meal. No resident is named or referenced here; per-resident dietary needs stay in the resident record."
          : recordKind === "menu_approval"
            ? "The menu and the approver are recorded exactly as stated. This records that an approval happened; it does not verify the approver's credential."
            : "One emergency food supply check. A temperature or stock reading is not a complete sanitation log."}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy ? <p role="status">Recording…</p> : null}
      {pending ? <button type="button" className={CONTROL} disabled={busy || disabled} onClick={() => retry(verify, () => {})}>Retry same dietary record</button> : null}
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <fieldset disabled={busy || pending !== null || disabled} className="space-y-3">
          <legend>Dietary source command · {enumLabel(recordKind, { case: "lower" })}</legend>
          <DateTimeInput id={`dietary-${recordKind}`} label="When it was done" value={performedAt} onChange={setPerformedAt} required timezone={timezone} />
          {recordKind === "meal_substitution" ? (
            <>
              <label className="block">
                Service date
                <input className={CONTROL} type="date" required value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
              </label>
              <label className="block">
                Meal
                <select className={CONTROL} value={mealPeriod} onChange={(event) => setMealPeriod(event.target.value)}>
                  <option value="">Choose the meal</option>
                  {MEAL_PERIODS.map((period) => <option key={period} value={period}>{MEAL_PERIOD_LABELS[period] ?? period}</option>)}
                </select>
              </label>
              <label className="block">
                Planned item
                <input className={CONTROL} required value={plannedItem} onChange={(event) => setPlannedItem(event.target.value)} />
              </label>
              <label className="block">
                Substitute served
                <input className={CONTROL} required value={substituteItem} onChange={(event) => setSubstituteItem(event.target.value)} />
              </label>
              <label className="block">
                Reason for the substitution
                <textarea className={CONTROL} required value={substitutionReason} onChange={(event) => setSubstitutionReason(event.target.value)} />
              </label>
            </>
          ) : recordKind === "menu_approval" ? (
            <>
              <label className="block">
                Menu as labelled
                <input className={CONTROL} required value={menuLabel} onChange={(event) => setMenuLabel(event.target.value)} />
              </label>
              <label className="block">
                Approver as stated
                <input className={CONTROL} required value={approverLabel} onChange={(event) => setApproverLabel(event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                Outcome
                <select className={CONTROL} value={outcome} onChange={(event) => setOutcome(event.target.value as "performed" | "failed")}>
                  <option value="performed">Performed</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              {outcome === "failed" ? (
                <label className="block">
                  What failed (required). Recording a failure keeps its follow-up open; it does not close the problem.
                  <textarea className={CONTROL} required value={issue} onChange={(event) => setIssue(event.target.value)} />
                </label>
              ) : null}
            </>
          )}
          <label className="block">
            Note
            <textarea className={CONTROL} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <label className="block">
            {LATE_ENTRY_LABEL}
            <textarea className={CONTROL} value={entryReason} onChange={(event) => setEntryReason(event.target.value)} />
          </label>
          <button className={CONTROL} disabled={!ready}>Record this dietary record</button>
        </fieldset>
      </form>
    </div>
  );
}
