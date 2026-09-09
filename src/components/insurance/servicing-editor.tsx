"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createEmptyServicingPayload,
  type ServicingKind,
  type ServicingPayload,
  type ServicingPayloadMap,
  type ServicingRecord,
  type ServicingWorkspace,
  type LossReportClaim,
  type WorkforceExposureRow,
} from "@/lib/insurance/servicing-types";
import { Field, controlClass, panelClass } from "./workspace-client";
import { servicingCommand } from "./servicing-client";
import { incidentChoiceLabel } from "./servicing-client";

export function ServicingEditor({
  kind,
  workspace,
  record,
  onSaved,
  onDirty,
}: {
  kind: ServicingKind;
  workspace: ServicingWorkspace;
  record?: ServicingRecord;
  onSaved: (record: ServicingRecord) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [id] = useState(() => record?.id || crypto.randomUUID());
  const [version, setVersion] = useState(record?.version);
  const [base, setBase] = useState(() => ({
    title: record?.title || "",
    entity_id: record?.entity_id || "",
    facility_id: record?.facility_id || null,
    policy_id: record?.policy_id || null,
    document_id: record?.document_id || null,
    owner_id: record?.owner_id || null,
    due_date: record?.due_date || null,
  }));
  const [payload, setPayload] = useState<ServicingPayload>(
    () => record?.payload || createEmptyServicingPayload(kind),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const changeBase = (patch: Partial<typeof base>) => {
    setBase((p) => ({ ...p, ...patch }));
    onDirty?.(true);
    setNotice("");
  };
  const changePayload = (patch: Partial<ServicingPayload>) => {
    setPayload((p) => ({ ...p, ...patch }) as ServicingPayload);
    onDirty?.(true);
    setNotice("");
  };
  async function save(requestReview: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = { ...payload };
      if ("policy_snapshot" in body) delete body.policy_snapshot;
      const saved = await servicingCommand<{ record: ServicingRecord }>(
        "save",
        { id, ...(version ? { version } : {}), kind, ...base, payload: body },
      );
      setVersion(saved.record.version);
      let result = saved.record;
      if (requestReview && saved.record.status !== "review_required") {
        result = (
          await servicingCommand<{ record: ServicingRecord }>("transition", {
            id,
            version: saved.record.version,
            status: "review_required",
          })
        ).record;
        setVersion(result.version);
      }
      onDirty?.(false);
      setNotice(
        requestReview
          ? "Record submitted for insurance review."
          : "Draft saved. It is not an approved insurance record.",
      );
      onSaved(result);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to save. Your edits are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <fieldset disabled={busy} className={panelClass}>
        <legend className="px-2 text-lg font-semibold">
          Record identity and responsibility
        </legend>
        <Field label="Record title">
          <Input
            required
            value={base.title}
            onChange={(e) => changeBase({ title: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal entity">
            <select
              className={controlClass}
              required
              value={base.entity_id}
              onChange={(e) =>
                changeBase({
                  entity_id: e.target.value,
                  facility_id: null,
                  policy_id: null,
                })
              }
            >
              <option value="">Choose exact legal entity</option>
              {workspace.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Facility scope">
            <select
              className={controlClass}
              value={base.facility_id || ""}
              onChange={(e) =>
                changeBase({ facility_id: e.target.value || null })
              }
            >
              <option value="">Organization record</option>
              {workspace.facilities
                .filter(
                  (f) =>
                    !base.entity_id ||
                    f.entity_id === base.entity_id ||
                    workspace.policies
                      .find((policy) => policy.id === base.policy_id)
                      ?.covered_facility_ids?.includes(f.id),
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field
            label="Related policy"
            hint={
              kind === "renewal_package"
                ? "A verified policy is required before package approval."
                : undefined
            }
          >
            <select
              className={controlClass}
              value={base.policy_id || ""}
              onChange={(e) =>
                changeBase({ policy_id: e.target.value || null })
              }
            >
              <option value="">No policy selected</option>
              {workspace.policies
                .filter(
                  (p) =>
                    (!base.entity_id ||
                      p.entity_id === base.entity_id ||
                      p.insured_entity_ids?.includes(base.entity_id)) &&
                    (kind !== "renewal_package" ||
                      p.verification_status === "verified"),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.carrier_name} · {p.policy_number} · v{p.version}
                  </option>
                ))}
            </select>
          </Field>
          <DocumentSelect
            label="Original evidence document"
            workspace={workspace}
            value={base.document_id}
            onChange={(value) => changeBase({ document_id: value })}
          />
          <Field label="Assigned record owner">
            <select
              className={controlClass}
              value={base.owner_id || ""}
              onChange={(e) => changeBase({ owner_id: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {workspace.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <DateField
            label="Record due date"
            value={base.due_date}
            onChange={(value) => changeBase({ due_date: value || null })}
          />
        </div>
      </fieldset>
      <fieldset disabled={busy} className={panelClass}>
        <legend className="px-2 text-lg font-semibold">Servicing facts</legend>
        {kind === "renewal_package" ? (
          <RenewalFields
            workspace={workspace}
            payload={payload as ServicingPayloadMap["renewal_package"]}
            onChange={changePayload}
          />
        ) : kind === "vendor_evidence" ? (
          <VendorFields
            workspace={workspace}
            payload={payload as ServicingPayloadMap["vendor_evidence"]}
            onChange={changePayload}
          />
        ) : kind === "loss_report" ? (
          <LossFields
            payload={payload as ServicingPayloadMap["loss_report"]}
            onChange={changePayload}
          />
        ) : kind === "claim_matter" ? (
          <ClaimFields
            payload={payload as ServicingPayloadMap["claim_matter"]}
            onChange={changePayload}
            workspace={workspace}
            facilityId={base.facility_id}
          />
        ) : (
          <ExposureFields
            payload={payload as ServicingPayloadMap["workforce_exposure"]}
            onChange={changePayload}
          />
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? "Saving…" : "Save servicing draft"}
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={(e) => {
            if (e.currentTarget.form?.reportValidity()) void save(true);
          }}
        >
          Save and request review
        </Button>
      </div>
    </form>
  );
}

type FieldsProps<K extends ServicingKind> = {
  payload: ServicingPayloadMap[K];
  onChange: (patch: Partial<ServicingPayloadMap[K]>) => void;
};
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="date"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
function TextArea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={controlClass}
        rows={3}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
export function DocumentSelect({
  label,
  workspace,
  value,
  onChange,
  families,
}: {
  label: string;
  workspace: ServicingWorkspace;
  value: string | null;
  onChange: (value: string | null) => void;
  families?: string[];
}) {
  return (
    <Field label={label}>
      <select
        className={controlClass}
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No document selected</option>
        {workspace.documents
          .filter(
            (d) =>
              d.status === "ready" &&
              (!families || families.includes(d.family)),
          )
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename}
            </option>
          ))}
      </select>
    </Field>
  );
}
function PeriodFields({
  payload,
  onChange,
}: {
  payload: { period_start: string; period_end: string };
  onChange: (patch: { period_start?: string; period_end?: string }) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <DateField
        label="Period start"
        value={payload.period_start}
        onChange={(value) => onChange({ period_start: value })}
      />
      <DateField
        label="Period end"
        value={payload.period_end}
        onChange={(value) => onChange({ period_end: value })}
      />
    </div>
  );
}
function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        className="mt-1"
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value / 100));
  return (
    <Field label={label} hint="USD; blank means unknown.">
      <Input
        inputMode="decimal"
        pattern={/^[0-9]+([.][0-9]{1,2})?$/.source}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          e.target.setCustomValidity("");
          if (!t.trim()) onChange(null);
          else if (/^[0-9]+([.][0-9]{0,2})?$/.test(t)) {
            const cents = Math.round(Number(t) * 100);
            if (!Number.isSafeInteger(cents) || cents > 2147483647) {
              e.target.setCustomValidity(
                "Enter an amount no greater than $21,474,836.47.",
              );
              onChange(value);
            } else onChange(cents);
          } else onChange(value);
        }}
      />
    </Field>
  );
}

function RenewalFields({
  payload,
  onChange,
  workspace,
}: FieldsProps<"renewal_package"> & { workspace: ServicingWorkspace }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The server snapshots the selected verified policy on save. If that
        policy changes before approval, save the draft again to refresh its
        snapshot.
      </p>
      <PeriodFields payload={payload} onChange={onChange} />
      <TextArea
        label="Location changes"
        value={payload.location_changes}
        onChange={(value) => onChange({ location_changes: value })}
      />
      <TextArea
        label="Exposure summary"
        value={payload.exposures}
        onChange={(value) => onChange({ exposures: value })}
      />
      <TextArea
        label="Open questions for the broker"
        value={payload.open_questions}
        onChange={(value) => onChange({ open_questions: value })}
      />
      <Field label="Intended package recipient">
        <Input
          value={payload.recipient}
          onChange={(e) => onChange({ recipient: e.target.value })}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          Included supporting documents
        </legend>
        {!workspace.documents.some((d) => d.status === "ready") && (
          <p className="text-sm">
            Upload supporting documents from the Documents tab.
          </p>
        )}
        {workspace.documents
          .filter((d) => d.status === "ready")
          .map((d) => (
            <Check
              key={d.id}
              label={d.filename}
              value={payload.document_ids.includes(d.id)}
              onChange={(checked) =>
                onChange({
                  document_ids: checked
                    ? [...payload.document_ids, d.id]
                    : payload.document_ids.filter((id) => id !== d.id),
                })
              }
            />
          ))}
      </fieldset>
    </div>
  );
}
function VendorFields({
  payload,
  onChange,
  workspace,
}: FieldsProps<"vendor_evidence"> & { workspace: ServicingWorkspace }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Use the original evidence selector above for the vendor certificate.
        Certificate wording alone does not prove an endorsement or satisfy
        requirements.
      </p>
      <Field label="Vendor">
        <select
          className={controlClass}
          value={payload.vendor_id}
          onChange={(e) =>
            onChange({ vendor_id: e.target.value, contract_id: null })
          }
        >
          <option value="">Choose vendor</option>
          {workspace.vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vendor contract">
        <select
          className={controlClass}
          value={payload.contract_id || ""}
          onChange={(e) => onChange({ contract_id: e.target.value || null })}
        >
          <option value="">No contract linked</option>
          {workspace.contracts
            .filter((c) => c.vendor_id === payload.vendor_id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
        </select>
      </Field>
      <TextArea
        label="Approved requirements to compare"
        value={payload.requirements}
        onChange={(value) => onChange({ requirements: value })}
      />
      <Check
        label="The requirements need supporting policy or endorsement evidence"
        value={payload.requires_endorsement}
        onChange={(value) => onChange({ requires_endorsement: value })}
      />
      {payload.requires_endorsement && (
        <>
          <DocumentSelect
            label="Supporting endorsement or policy"
            workspace={workspace}
            value={payload.endorsement_document_id}
            onChange={(value) => onChange({ endorsement_document_id: value })}
            families={["endorsement", "policy"]}
          />
          <Field label="Endorsement evidence page">
            <Input
              type="number"
              min={1}
              step={1}
              value={payload.endorsement_page ?? ""}
              onChange={(e) =>
                onChange({
                  endorsement_page: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </Field>
        </>
      )}
      <TextArea
        label="Requirement assessment"
        hint="Record the comparison, unresolved limitations and the supporting provisions."
        value={payload.assessment}
        onChange={(value) => onChange({ assessment: value })}
      />
      <DateField
        label="Evidence expiration date"
        value={payload.expiration_date}
        onChange={(value) => onChange({ expiration_date: value })}
      />
      <TextArea
        label="Exception reason"
        hint="Required for a deliberate exception approval; an exception is not normal requirement acceptance."
        value={payload.exception_reason}
        onChange={(value) => onChange({ exception_reason: value || null })}
      />
    </div>
  );
}

function LossFields({ payload, onChange }: FieldsProps<"loss_report">) {
  const [rowKeys, setRowKeys] = useState(() =>
    payload.claims.map(() => crypto.randomUUID()),
  );
  const patch = (index: number, changes: Partial<LossReportClaim>) =>
    onChange({
      claims: payload.claims.map((row, i) =>
        i === index ? { ...row, ...changes } : row,
      ),
    });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Keep carrier-reported figures separate from client costs. Unknown
        amounts remain blank; a later valuation replaces earlier authority in
        totals rather than adding the same claim twice.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reporting carrier">
          <Input
            value={payload.carrier_name}
            onChange={(e) => onChange({ carrier_name: e.target.value })}
          />
        </Field>
        <Field label="Reported coverage line">
          <Input
            value={payload.coverage_line}
            onChange={(e) => onChange({ coverage_line: e.target.value })}
          />
        </Field>
        <DateField
          label="Report valuation date"
          value={payload.valuation_date}
          onChange={(value) => onChange({ valuation_date: value })}
        />
      </div>
      <PeriodFields payload={payload} onChange={onChange} />
      <Check
        label="The requested reporting periods are complete"
        value={payload.complete_periods}
        onChange={(value) => onChange({ complete_periods: value })}
      />
      <Check
        label="The source explicitly confirms no losses for this period"
        value={payload.no_losses_confirmed}
        onChange={(value) => onChange({ no_losses_confirmed: value })}
      />
      {payload.no_losses_confirmed && (
        <Field label="No-loss statement evidence page">
          <Input
            type="number"
            min={1}
            step={1}
            value={payload.no_loss_evidence_page ?? ""}
            onChange={(e) =>
              onChange({
                no_loss_evidence_page: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
        </Field>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] border-collapse text-sm">
          <caption className="py-3 text-left font-semibold">
            Reported claim rows
          </caption>
          <thead>
            <tr>
              {[
                "Claim identity",
                "Paid / reserve",
                "Recovery / expense",
                "Reported incurred",
                "Evidence",
              ].map((h) => (
                <th className="border border-border p-3 text-left" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.claims.map((row, i) => (
              <tr key={rowKeys[i]}>
                <td className="space-y-3 border border-border p-3 align-top">
                  <Field label={`Claim ${i + 1} reference`}>
                    <Input
                      value={row.claim_reference}
                      onChange={(e) =>
                        patch(i, { claim_reference: e.target.value })
                      }
                    />
                  </Field>
                  <DateField
                    label={`Claim ${i + 1} loss date`}
                    value={row.loss_date}
                    onChange={(value) => patch(i, { loss_date: value || null })}
                  />
                </td>
                <td className="space-y-3 border border-border p-3 align-top">
                  <MoneyInput
                    label={`Claim ${i + 1} paid`}
                    value={row.paid_cents}
                    onChange={(value) => patch(i, { paid_cents: value })}
                  />
                  <MoneyInput
                    label={`Claim ${i + 1} reserve`}
                    value={row.reserve_cents}
                    onChange={(value) => patch(i, { reserve_cents: value })}
                  />
                </td>
                <td className="space-y-3 border border-border p-3 align-top">
                  <MoneyInput
                    label={`Claim ${i + 1} recovery`}
                    value={row.recovery_cents}
                    onChange={(value) => patch(i, { recovery_cents: value })}
                  />
                  <MoneyInput
                    label={`Claim ${i + 1} expense`}
                    value={row.expense_cents}
                    onChange={(value) => patch(i, { expense_cents: value })}
                  />
                </td>
                <td className="space-y-3 border border-border p-3 align-top">
                  <MoneyInput
                    label={`Claim ${i + 1} reported incurred`}
                    value={row.incurred_cents}
                    onChange={(value) => patch(i, { incurred_cents: value })}
                  />
                  <Field label={`Claim ${i + 1} incurred includes expenses`}>
                    <select
                      className={controlClass}
                      value={
                        row.incurred_includes_expenses == null
                          ? "unknown"
                          : String(row.incurred_includes_expenses)
                      }
                      onChange={(e) =>
                        patch(i, {
                          incurred_includes_expenses:
                            e.target.value === "unknown"
                              ? null
                              : e.target.value === "true",
                        })
                      }
                    >
                      <option value="unknown">Unknown</option>
                      <option value="true">Includes expenses</option>
                      <option value="false">Excludes expenses</option>
                    </select>
                  </Field>
                </td>
                <td className="space-y-3 border border-border p-3 align-top">
                  <Field label={`Claim ${i + 1} source page`}>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={row.page ?? ""}
                      onChange={(e) =>
                        patch(i, {
                          page: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRowKeys((keys) => keys.filter((_, n) => n !== i));
                      onChange({
                        claims: payload.claims.filter((_, n) => n !== i),
                      });
                    }}
                  >
                    Remove claim {i + 1}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setRowKeys((keys) => [...keys, crypto.randomUUID()]);
          onChange({
            claims: [
              ...payload.claims,
              {
                claim_reference: "",
                loss_date: null,
                paid_cents: null,
                reserve_cents: null,
                recovery_cents: null,
                expense_cents: null,
                incurred_cents: null,
                incurred_includes_expenses: null,
                page: null,
              },
            ],
          });
        }}
      >
        Add reported claim
      </Button>
    </div>
  );
}
function ClaimFields({
  payload,
  onChange,
  workspace,
  facilityId,
}: FieldsProps<"claim_matter"> & {
  workspace: ServicingWorkspace;
  facilityId: string | null;
}) {
  const choices = (workspace.incidents || []).filter(
    (incident) => incident.facility_id === facilityId,
  );
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border bg-muted p-3 text-sm">
        Enter a concise insurance servicing summary manually. Do not copy
        clinical notes, medical details or employee/claimant identities. Linking
        an incident does not report it to an insurer.
      </p>
      <Field
        label="Proposed incident"
        hint={
          facilityId
            ? "Choose a dated facility incident. Clinical records remain separate from these insurance notes."
            : "Choose a facility above to link an incident."
        }
      >
        <select
          className={controlClass}
          value={payload.incident_id || ""}
          onChange={(event) =>
            onChange({ incident_id: event.target.value || null })
          }
        >
          <option value="">No incident linked</option>
          {payload.incident_id &&
            !choices.some((i) => i.id === payload.incident_id) && (
              <option value={payload.incident_id} disabled>
                Previously linked incident is unavailable
              </option>
            )}
          {choices.map((incident) => (
            <option key={incident.id} value={incident.id}>
              {incidentChoiceLabel(incident, workspace)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Carrier matter reference">
        <Input
          value={payload.carrier_reference || ""}
          onChange={(e) =>
            onChange({ carrier_reference: e.target.value || null })
          }
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          label="Date of loss"
          value={payload.loss_date}
          onChange={(value) => onChange({ loss_date: value })}
        />
        <DateField
          label="Known reporting date"
          value={payload.reported_date}
          onChange={(value) => onChange({ reported_date: value || null })}
        />
      </div>
      <TextArea
        label="Insurance matter summary"
        value={payload.description}
        onChange={(value) => onChange({ description: value })}
      />
      <TextArea
        label="Next servicing action"
        value={payload.next_action}
        onChange={(value) => onChange({ next_action: value })}
      />
      <Field label="Known servicing recipient">
        <Input
          value={payload.recipient || ""}
          onChange={(e) => onChange({ recipient: e.target.value || null })}
        />
      </Field>
      <TextArea
        label="Existing acknowledgment evidence"
        value={payload.acknowledgment}
        onChange={(value) => onChange({ acknowledgment: value || null })}
      />
    </div>
  );
}
const STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );
function ExposureFields({
  payload,
  onChange,
}: FieldsProps<"workforce_exposure">) {
  const [rowKeys, setRowKeys] = useState(() =>
    payload.rows.map(() => crypto.randomUUID()),
  );
  const patch = (index: number, changes: Partial<WorkforceExposureRow>) =>
    onChange({
      rows: payload.rows.map((row, i) =>
        i === index ? { ...row, ...changes } : row,
      ),
    });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Collect aggregate exposure only. Keep estimated and actual payroll
        separate; do not enter employee names, individual wages or medical
        information.
      </p>
      <PeriodFields payload={payload} onChange={onChange} />
      <TextArea
        label="Manual exposure source reason"
        hint="Required when no supporting original is attached."
        value={payload.manual_source_reason}
        onChange={(value) => onChange({ manual_source_reason: value || null })}
      />
      <Check
        label="The broker confirmed these state and class-code mappings"
        value={payload.broker_mapping_confirmed}
        onChange={(value) => onChange({ broker_mapping_confirmed: value })}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="py-3 text-left font-semibold">
            Exposure by state and classification
          </caption>
          <thead>
            <tr>
              {[
                "State and class",
                "Estimated payroll",
                "Actual payroll",
                "Source and basis",
              ].map((h) => (
                <th className="border border-border p-3 text-left" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, i) => (
              <tr key={rowKeys[i]}>
                <td className="space-y-3 border border-border p-3 align-top">
                  <Field label={`Exposure ${i + 1} state`}>
                    <select
                      className={controlClass}
                      value={row.state}
                      onChange={(e) => patch(i, { state: e.target.value })}
                    >
                      <option value="">Choose state</option>
                      {[...new Set(STATES)].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Exposure ${i + 1} class code`}>
                    <Input
                      value={row.class_code}
                      onChange={(e) => patch(i, { class_code: e.target.value })}
                    />
                  </Field>
                </td>
                <td className="border border-border p-3 align-top">
                  <MoneyInput
                    label={`Exposure ${i + 1} estimated payroll`}
                    value={row.estimated_payroll_cents}
                    onChange={(value) =>
                      patch(i, { estimated_payroll_cents: value })
                    }
                  />
                </td>
                <td className="border border-border p-3 align-top">
                  <MoneyInput
                    label={`Exposure ${i + 1} actual payroll`}
                    value={row.actual_payroll_cents}
                    onChange={(value) =>
                      patch(i, { actual_payroll_cents: value })
                    }
                  />
                </td>
                <td className="space-y-3 border border-border p-3 align-top">
                  <TextArea
                    label={`Exposure ${i + 1} basis note`}
                    value={row.basis_note}
                    onChange={(value) => patch(i, { basis_note: value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRowKeys((keys) => keys.filter((_, n) => n !== i));
                      onChange({
                        rows: payload.rows.filter((_, n) => n !== i),
                      });
                    }}
                  >
                    Remove exposure {i + 1}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setRowKeys((keys) => [...keys, crypto.randomUUID()]);
          onChange({
            rows: [
              ...payload.rows,
              {
                state: "",
                class_code: "",
                estimated_payroll_cents: null,
                actual_payroll_cents: null,
                basis_note: "",
              },
            ],
          });
        }}
      >
        Add exposure row
      </Button>
      <TextArea
        label="Aggregate exposure notes"
        value={payload.notes}
        onChange={(value) => onChange({ notes: value })}
      />
    </div>
  );
}
