"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SERVICING_KINDS,
  type ServicingKind,
  type ServicingRecord,
  type ServicingStatus,
  type ServicingWorkspace,
  type ServicingVersion,
} from "@/lib/insurance/servicing-types";
import {
  Field,
  controlClass,
  moneyLabel,
  panelClass,
  readable,
} from "./workspace-client";
import type { InsurancePolicy } from "@/lib/insurance/workspace-types";
import { ServicingEditor } from "./servicing-editor";
import {
  SERVICING_LABELS,
  ServicingShell,
  servicingCommand,
  useServicingWorkspace,
  incidentChoiceLabel,
} from "./servicing-client";

export function ServicingListPage() {
  const state = useServicingWorkspace();
  const search = useSearchParams();
  const router = useRouter();
  const candidate = search.get("kind");
  const kind: ServicingKind = SERVICING_KINDS.includes(
    candidate as ServicingKind,
  )
    ? (candidate as ServicingKind)
    : "renewal_package";
  return (
    <ServicingShell title="Insurance servicing" state={state}>
      {state.data && (
        <>
          <nav
            aria-label="Servicing record types"
            className="flex flex-wrap gap-3"
          >
            {SERVICING_KINDS.map((k) => (
              <Link
                className={`rounded-lg border border-border px-3 py-2 text-sm ${kind === k ? "bg-primary text-primary-foreground" : "bg-card"}`}
                aria-current={kind === k ? "page" : undefined}
                href={`/admin/insurance/servicing?kind=${k}`}
                key={k}
              >
                {SERVICING_LABELS[k]}
              </Link>
            ))}
          </nav>
          {kind === "loss_report" && <LossTotals workspace={state.data} />}
          <section className={panelClass}>
            <h2 className="text-lg font-semibold">{SERVICING_LABELS[kind]}</h2>
            {!state.data.records.some((r) => r.kind === kind) ? (
              <p>No servicing records of this type yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {state.data.records
                  .filter((r) => r.kind === kind)
                  .map((r) => (
                    <li className="space-y-1 py-3" key={r.id}>
                      <Link
                        className="font-medium text-primary underline"
                        href={`/admin/insurance/servicing/${r.id}`}
                      >
                        {r.title}
                      </Link>
                      <p className="text-sm">
                        {readable(r.status)} · Version {r.version} · Due{" "}
                        {r.due_date || "unassigned"}
                        {r.superseded_by && " · superseded by a correction"}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </section>
          <details className={panelClass}>
            <summary className="cursor-pointer text-lg font-semibold">
              Create {SERVICING_LABELS[kind].toLowerCase()} record
            </summary>
            <div className="mt-5">
              <ServicingEditor
                key={kind}
                kind={kind}
                workspace={state.data}
                onSaved={(r) =>
                  router.push(`/admin/insurance/servicing/${r.id}`)
                }
              />
            </div>
          </details>
          <LegacyLinks kind={kind} />
        </>
      )}
    </ServicingShell>
  );
}

export function ServicingDetailPage() {
  const state = useServicingWorkspace();
  const params = useParams();
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const record = state.data?.records.find((r) => r.id === params.id);
  return (
    <ServicingShell title="Insurance servicing record" state={state}>
      {state.data &&
        (record ? (
          <>
            <Link
              className="text-primary underline"
              href={`/admin/insurance/servicing?kind=${record.kind}`}
            >
              Back to {SERVICING_LABELS[record.kind].toLowerCase()}
            </Link>
            <ServicingRecordSummary record={record} workspace={state.data} />
            {["draft", "review_required"].includes(record.status) ? (
              <details open className={panelClass}>
                <summary className="cursor-pointer font-semibold">
                  Edit draft facts
                </summary>
                <div className="mt-4">
                  <ServicingEditor
                    key={`${record.id}:${record.version}`}
                    kind={record.kind}
                    record={record}
                    workspace={state.data}
                    onDirty={setDirty}
                    onSaved={() => {
                      setDirty(false);
                      state.refresh();
                    }}
                  />
                </div>
              </details>
            ) : (
              <section className={panelClass}>
                <p>
                  This reviewed payload is frozen. Create a new revision to
                  propose corrections while preserving this record.
                </p>
                {record.kind === "loss_report" && (
                  <p className="text-sm">
                    A revision corrects this source valuation. For a later
                    valuation or a new reporting period, create a separate loss
                    report.
                  </p>
                )}
                {record.superseded_by ? (
                  <Link
                    className="text-primary underline"
                    href={`/admin/insurance/servicing/${record.superseded_by}`}
                  >
                    Open the authoritative correction
                  </Link>
                ) : (
                  <ReviseButton
                    record={record}
                    onCreated={(r) =>
                      router.push(`/admin/insurance/servicing/${r.id}`)
                    }
                  />
                )}
              </section>
            )}
            <TransitionForm
              key={`${record.id}:${record.version}`}
              record={record}
              dirty={dirty}
              refresh={state.refresh}
            />
            <ReassignmentForm
              key={`assignment:${record.id}:${record.version}`}
              record={record}
              workspace={state.data}
              dirty={dirty}
              refresh={state.refresh}
            />
            {record.kind === "renewal_package" &&
              ["approved", "shared", "acknowledged"].includes(
                record.status,
              ) && <PackageExport record={record} />}
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">
                Immutable version and action history
              </h2>
              {(
                record.versions ||
                state.data.versions?.filter((v) => v.record_id === record.id) ||
                []
              ).map((v) => (
                <VersionHistory
                  key={v.id}
                  version={v}
                  workspace={state.data!}
                />
              ))}
            </section>
          </>
        ) : (
          <p className={panelClass}>
            Record unavailable in the current organization.
          </p>
        ))}
    </ServicingShell>
  );
}
function LegacyLinks({ kind }: { kind: ServicingKind }) {
  const links: Partial<Record<ServicingKind, { href: string; label: string }>> =
    {
      renewal_package: {
        href: "/admin/insurance/renewal-packages",
        label: "View legacy package archive",
      },
      loss_report: {
        href: "/admin/insurance/loss-runs",
        label: "View legacy loss-run register",
      },
      claim_matter: {
        href: "/admin/insurance/claims",
        label: "View existing insurance claims",
      },
      workforce_exposure: {
        href: "/admin/insurance/workers-comp",
        label: "View existing workers’ compensation register",
      },
      vendor_evidence: {
        href: "/admin/insurance/coi",
        label: "Open our certificate requests",
      },
    };
  const link = links[kind];
  return link ? (
    <Link className="text-primary underline" href={link.href}>
      {link.label}
    </Link>
  ) : null;
}
function ReviseButton({
  record,
  onCreated,
}: {
  record: ServicingRecord;
  onCreated: (r: ServicingRecord) => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await servicingCommand<{ record: ServicingRecord }>(
              "revise",
              { id: record.id, version: record.version, new_id: id },
            );
            onCreated(result.record);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not create revision.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating revision…" : "Create new revision"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
const STATUS_LABELS: Partial<Record<ServicingStatus, string>> = {
  review_required: "Request review",
  approved: "Approve reviewed record",
  exception_approved: "Approve stated exception",
  rejected: "Reject draft",
  shared: "Record completed handoff",
  acknowledged: "Record recipient acknowledgment",
  closed: "Close insurance matter",
};
function nextStates(record: ServicingRecord): ServicingStatus[] {
  if (record.superseded_by) return [];
  if (record.status === "draft") return ["rejected"];
  if (record.status === "review_required")
    return record.kind === "vendor_evidence"
      ? ["approved", "exception_approved", "rejected"]
      : ["approved", "rejected"];
  if (
    record.status === "approved" &&
    ["renewal_package", "claim_matter"].includes(record.kind)
  )
    return ["shared"];
  if (record.status === "shared") return ["acknowledged"];
  if (record.status === "acknowledged" && record.kind === "claim_matter")
    return ["closed"];
  return [];
}
export function TransitionForm({
  record,
  dirty,
  refresh,
}: {
  record: ServicingRecord;
  dirty: boolean;
  refresh: () => void;
}) {
  const choices = nextStates(record);
  const [status, setStatus] = useState<ServicingStatus>(
    choices[0] || "approved",
  );
  const [note, setNote] = useState("");
  const [recipient, setRecipient] = useState("");
  const [ack, setAck] = useState("");
  const [reported, setReported] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const approval = ["approved", "exception_approved"].includes(status);
  if (!choices.length) return null;
  return (
    <form
      className={panelClass}
      onSubmit={async (e) => {
        e.preventDefault();
        if (dirty) return;
        setBusy(true);
        setError("");
        try {
          await servicingCommand("transition", {
            id: record.id,
            version: record.version,
            status,
            ...(note ? { note } : {}),
            ...(recipient ? { recipient } : {}),
            ...(ack ? { acknowledgment: ack } : {}),
            ...(reported ? { reported_date: reported } : {}),
          });
          setMessage("Action recorded in version history.");
          refresh();
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "Unable to record action.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Review and servicing action</h2>
      {dirty && (
        <p className="text-sm">
          Save draft changes before reviewing or recording an action.
        </p>
      )}
      <Field label="Servicing action">
        <select
          className={controlClass}
          disabled={busy || dirty}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ServicingStatus);
            setConfirmed(false);
          }}
        >
          {choices.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      {approval && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I checked the record, source evidence, entity and location scope,
            requirements and any stated exception.
          </span>
        </label>
      )}
      {["shared", "acknowledged"].includes(status) && (
        <>
          <p className="text-sm text-muted-foreground">
            This records a handoff or acknowledgment already performed by an
            authorized person. Haven does not send this record.
          </p>
          <Field label="Exact handoff recipient">
            <Input
              required
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </Field>
        </>
      )}
      {status === "acknowledged" && (
        <>
          <Field label="Recipient acknowledgment evidence">
            <textarea
              required
              className={controlClass}
              value={ack}
              onChange={(e) => setAck(e.target.value)}
            />
          </Field>
          {record.kind === "claim_matter" && (
            <Field label="Recorded reporting date">
              <Input
                type="date"
                required
                value={reported}
                onChange={(e) => setReported(e.target.value)}
              />
            </Field>
          )}
        </>
      )}
      <Field
        label="Action note"
        hint="For a handoff, record the exact exported version and how it was delivered. For rejection or closure, record the reason."
      >
        <textarea
          className={controlClass}
          required={["shared", "rejected", "closed"].includes(status)}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Button
        type="submit"
        disabled={busy || dirty || (approval && !confirmed)}
      >
        {busy ? "Recording…" : STATUS_LABELS[status]}
      </Button>
    </form>
  );
}
export function ReassignmentForm({
  record,
  workspace,
  dirty,
  refresh,
}: {
  record: ServicingRecord;
  workspace: ServicingWorkspace;
  dirty: boolean;
  refresh: () => void;
}) {
  const [owner, setOwner] = useState(record.owner_id || "");
  const [due, setDue] = useState(record.due_date || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const validOwner = !owner || workspace.owners.some((o) => o.id === owner);
  return (
    <form
      className={panelClass}
      onSubmit={async (event) => {
        event.preventDefault();
        if (dirty || !validOwner || !reason.trim()) return;
        setBusy(true);
        setError("");
        try {
          await servicingCommand("reassign", {
            id: record.id,
            version: record.version,
            owner_id: owner || null,
            due_date: due || null,
            note: reason.trim(),
          });
          setMessage(
            "Operational assignment recorded in history. Prepared package details are unchanged.",
          );
          refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to update the assignment. Your changes are still here.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">
        Current operational responsibility
      </h2>
      <p className="text-sm text-muted-foreground">
        Change the current assignee or due date without changing approved facts
        or the owner recorded when the package was prepared.
      </p>
      <p className="text-sm">
        Current owner:{" "}
        {record.owner_id
          ? workspace.owners.find((o) => o.id === record.owner_id)?.name ||
            "Former assignee is inactive or unavailable"
          : "Unassigned"}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current operational owner">
          <select
            className={controlClass}
            value={owner}
            disabled={busy || dirty}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">Unassigned</option>
            {owner && !validOwner && (
              <option value={owner} disabled>
                Former assignee — select a current owner
              </option>
            )}
            {workspace.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Operational due date">
          <Input
            type="date"
            value={due}
            disabled={busy || dirty}
            onChange={(event) => setDue(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Assignment change reason">
        <textarea
          required
          className={controlClass}
          value={reason}
          disabled={busy || dirty}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {dirty && (
        <p className="text-sm">
          Save draft changes before changing the operational assignment.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Button
        type="submit"
        disabled={busy || dirty || !validOwner || !reason.trim()}
      >
        {busy ? "Recording assignment…" : "Record assignment change"}
      </Button>
    </form>
  );
}

function PackageExport({ record }: { record: ServicingRecord }) {
  return (
    <section className={panelClass}>
      <h2 className="text-lg font-semibold">Export the approved package</h2>
      <p className="text-sm">
        Exported content is the immutable record version shown here. Downloading
        does not record a handoff or send it to the broker.
      </p>
      <div className="flex flex-wrap gap-4">
        <a
          className="text-primary underline"
          href={`/api/insurance/servicing/${record.id}/export?version=${record.version}`}
        >
          Download approved package file
        </a>
        <Link
          className="text-primary underline"
          href={`/admin/insurance/servicing/${record.id}/print?version=${record.version}`}
        >
          Open printable approved package
        </Link>
      </div>
    </section>
  );
}
function preparedName(
  stored: string | null | undefined,
  current: string | undefined,
  emptyLabel = "Not recorded",
) {
  if (stored !== undefined) return stored ?? emptyLabel;
  return current ? `${current} (current directory label)` : "Unknown";
}
function Value({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm">
        {children || "Not recorded"}
      </dd>
    </div>
  );
}
function DocumentLink({
  id,
  workspace,
}: {
  id: string | null;
  workspace: ServicingWorkspace;
}) {
  return id ? (
    <Link
      className="text-primary underline"
      href={`/admin/insurance/documents/${id}`}
    >
      {workspace.documents.find((d) => d.id === id)?.filename ||
        "Source document"}
    </Link>
  ) : (
    <>No document attached</>
  );
}
export function ServicingRecordSummary({
  record,
  workspace,
}: {
  record: ServicingRecord;
  workspace: ServicingWorkspace;
}) {
  return (
    <section className={panelClass}>
      <div>
        <h2 className="text-xl font-semibold">{record.title}</h2>
        <p className="text-sm">
          {SERVICING_LABELS[record.kind]} · {readable(record.status)} · Version{" "}
          {record.version}
          {record.superseded_by && " · superseded"}
        </p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Value label="Legal entity">
          {preparedName(
            record.display_names?.entity,
            workspace.entities.find((e) => e.id === record.entity_id)?.name,
          )}
        </Value>
        <Value label="Facility">
          {record.facility_id
            ? preparedName(
                record.display_names?.facility,
                workspace.facilities.find((f) => f.id === record.facility_id)
                  ?.name,
              )
            : "Organization scope"}
        </Value>
        <Value label="Related policy">
          {workspace.policies.find((x) => x.id === record.policy_id)
            ?.policy_number || "No linked policy"}
        </Value>
        <Value label="Original evidence">
          <DocumentLink id={record.document_id} workspace={workspace} />
        </Value>
        <Value label="Owner at preparation">
          {preparedName(
            record.display_names?.owner,
            workspace.owners.find((o) => o.id === record.owner_id)?.name,
            "Unassigned",
          )}
        </Value>
        <Value label="Due date">{record.due_date || "Unassigned"}</Value>
      </dl>
      {record.source_record_id && (
        <Link
          className="text-sm text-primary underline"
          href={`/admin/insurance/servicing/${record.source_record_id}`}
        >
          View source record for this revision
        </Link>
      )}
      {record.kind === "renewal_package" && (
        <>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Value label="Period">
              {record.payload.period_start} – {record.payload.period_end}
            </Value>
            <Value label="Intended recipient">{record.payload.recipient}</Value>
            <Value label="Location changes">
              {record.payload.location_changes}
            </Value>
            <Value label="Exposure summary">{record.payload.exposures}</Value>
            <Value label="Open questions">
              {record.payload.open_questions}
            </Value>
            <Value label="Frozen policy snapshot">
              {record.payload.policy_snapshot
                ? `${String(record.payload.policy_snapshot.carrier_name || "")} · ${String(record.payload.policy_snapshot.policy_number || "")} · version ${String(record.payload.policy_snapshot.version ?? "recorded")}`
                : "Snapshot will be captured by the server on save"}
            </Value>
          </dl>
          {record.payload.policy_snapshot && (
            <FrozenPolicySnapshot
              snapshot={record.payload.policy_snapshot}
              workspace={workspace}
            />
          )}
          <h3 className="font-semibold">Included documents</h3>
          <ul>
            {record.payload.document_ids.map((id) => (
              <li key={id}>
                <DocumentLink id={id} workspace={workspace} />
              </li>
            ))}
          </ul>
        </>
      )}
      {record.kind === "vendor_evidence" && (
        <>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Value label="Vendor">
              {preparedName(
                record.display_names?.vendor,
                workspace.vendors.find((v) => v.id === record.payload.vendor_id)
                  ?.name,
              )}
            </Value>
            <Value label="Contract">
              {record.payload.contract_id
                ? preparedName(
                    record.display_names?.contract,
                    workspace.contracts.find(
                      (c) => c.id === record.payload.contract_id,
                    )?.title,
                  )
                : "No contract linked"}
            </Value>
            <Value label="Compared requirements">
              {record.payload.requirements}
            </Value>
            <Value label="Requirement assessment">
              {record.payload.assessment}
            </Value>
            <Value label="Endorsement required">
              {record.payload.requires_endorsement
                ? "Yes — supporting policy or endorsement required"
                : "No, as recorded by reviewer"}
            </Value>
            <Value label="Endorsement evidence">
              <DocumentLink
                id={record.payload.endorsement_document_id}
                workspace={workspace}
              />{" "}
              · Page {record.payload.endorsement_page || "unknown"}
            </Value>
            <Value label="Evidence expiration">
              {record.payload.expiration_date || "Unknown"}
              {record.payload.expiration_date &&
              record.payload.expiration_date <
                new Date().toLocaleDateString("en-CA", {
                  timeZone: "America/New_York",
                })
                ? " · Expired"
                : ""}
            </Value>
            <Value label="Exception reason">
              {record.payload.exception_reason || "No exception recorded"}
            </Value>
          </dl>
          <p className="text-sm">
            Expiration is separate from requirement acceptance. An exception
            approval preserves the stated limitation.
          </p>
        </>
      )}
      {record.kind === "loss_report" && (
        <>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Value label="Carrier">{record.payload.carrier_name}</Value>
            <Value label="Valuation date">
              {record.payload.valuation_date}
            </Value>
            <Value label="Coverage line">{record.payload.coverage_line}</Value>
            <Value label="Reported period">
              {record.payload.period_start} – {record.payload.period_end}
            </Value>
            <Value label="Period completeness">
              {record.payload.complete_periods
                ? "Confirmed complete"
                : "Incomplete or not confirmed"}
            </Value>
            <Value label="No-loss statement">
              {record.payload.no_losses_confirmed
                ? `Explicitly confirmed, source page ${record.payload.no_loss_evidence_page || "missing"}`
                : "No no-loss assertion"}
            </Value>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="py-2 text-left font-semibold">
                Carrier-reported claim figures; not client retained costs
              </caption>
              <thead>
                <tr>
                  {[
                    "Claim",
                    "Loss date",
                    "Paid",
                    "Reserve",
                    "Recovery",
                    "Expense",
                    "Reported incurred",
                    "Expense basis",
                    "Page",
                  ].map((h) => (
                    <th className="whitespace-nowrap p-2" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.payload.claims.map((c, i) => (
                  <tr className="border-t border-border" key={i}>
                    <td className="p-2">{c.claim_reference}</td>
                    <td className="p-2">{c.loss_date || "Unknown"}</td>
                    {[
                      c.paid_cents,
                      c.reserve_cents,
                      c.recovery_cents,
                      c.expense_cents,
                      c.incurred_cents,
                    ].map((v, n) => (
                      <td className="whitespace-nowrap p-2" key={n}>
                        {moneyLabel(v)}
                      </td>
                    ))}
                    <td className="p-2">
                      {c.incurred_includes_expenses == null
                        ? "Unknown"
                        : c.incurred_includes_expenses
                          ? "Included"
                          : "Excluded"}
                    </td>
                    <td className="p-2">{c.page || "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {record.kind === "claim_matter" && (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Value label="Proposed incident link">
            {record.payload.incident_id
              ? record.display_names?.incident ||
                (() => {
                  const incident = workspace.incidents?.find(
                    (i) => i.id === record.payload.incident_id,
                  );
                  return incident
                    ? `${incidentChoiceLabel(incident, workspace)} (current record label)`
                    : "Linked incident details unavailable";
                })()
              : "No incident linked"}
          </Value>
          <Value label="Carrier reference">
            {record.payload.carrier_reference}
          </Value>
          <Value label="Loss date">{record.payload.loss_date}</Value>
          <Value label="Initially known reporting date">
            {record.payload.reported_date}
          </Value>
          <Value label="Insurance matter summary">
            {record.payload.description}
          </Value>
          <Value label="Next action">{record.payload.next_action}</Value>
          <Value label="Initially recorded recipient">
            {record.payload.recipient}
          </Value>
          <Value label="Initially recorded acknowledgment">
            {record.payload.acknowledgment}
          </Value>
        </dl>
      )}
      {record.kind === "workforce_exposure" && (
        <>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Value label="Exposure period">
              {record.payload.period_start} – {record.payload.period_end}
            </Value>
            <Value label="Broker mapping confirmation">
              {record.payload.broker_mapping_confirmed
                ? "Confirmed"
                : "Not confirmed"}
            </Value>
            <Value label="Manual source reason">
              {record.payload.manual_source_reason}
            </Value>
            <Value label="Aggregate notes">{record.payload.notes}</Value>
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="py-2 text-left font-semibold">
                Estimated and actual payroll remain separate
              </caption>
              <thead>
                <tr>
                  {[
                    "State",
                    "Class code",
                    "Estimated payroll",
                    "Actual payroll",
                    "Basis",
                  ].map((h) => (
                    <th className="p-2" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.payload.rows.map((r, i) => (
                  <tr className="border-t border-border" key={i}>
                    <td className="p-2">{r.state}</td>
                    <td className="p-2">{r.class_code}</td>
                    <td className="p-2">
                      {moneyLabel(r.estimated_payroll_cents)}
                    </td>
                    <td className="p-2">
                      {moneyLabel(r.actual_payroll_cents)}
                    </td>
                    <td className="p-2">{r.basis_note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {record.event_metadata?.action && (
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="font-semibold">
            Most recent recorded servicing event
          </h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Value label="Action">
              {readable(record.event_metadata.action)}
            </Value>
            <Value label="Recipient">{record.event_metadata.recipient}</Value>
            <Value label="Action note">{record.event_metadata.note}</Value>
            <Value label="Acknowledgment evidence">
              {record.event_metadata.acknowledgment}
            </Value>
            <Value label="Recorded reporting date">
              {record.event_metadata.reported_date}
            </Value>
          </dl>
        </section>
      )}
    </section>
  );
}
function FrozenPolicySnapshot({
  snapshot,
  workspace,
}: {
  snapshot: Record<string, unknown>;
  workspace: ServicingWorkspace;
}) {
  const policy = snapshot as Partial<InsurancePolicy>;
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="font-semibold">Saved policy version and dated schedule</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Value label="Snapshot term">
          {policy.effective_date || "Unknown"} –{" "}
          {policy.expiration_date || "Unknown"}
        </Value>
        <Value label="Snapshot stated premium">
          {moneyLabel(policy.premium_cents)}
        </Value>
        <Value label="Snapshot limit sharing">
          {policy.shared_limit == null
            ? "Unknown"
            : policy.shared_limit
              ? "Shared across linked locations"
              : "Not shared, as reviewed"}
        </Value>
      </dl>
      <p className="text-xs text-muted-foreground">
        These values, prepared directory names and relationship IDs were
        captured on save. Any older name fallback is labeled current.
      </p>
      <ul className="space-y-2 text-sm">
        {policy.parties?.map((p, i) => (
          <li key={i}>
            {preparedName(
              (p as typeof p & { entity_name?: string }).entity_name,
              workspace.entities.find((e) => e.id === p.entity_id)?.name,
            )}{" "}
            · {readable(p.role)} · {p.effective_from} –{" "}
            {p.effective_to || policy.expiration_date}
            <span className="block font-mono text-xs text-muted-foreground">
              Entity reference {p.entity_id}
            </span>
          </li>
        ))}
        {policy.facilities?.map((f, i) => (
          <li key={i}>
            {preparedName(
              (f as typeof f & { facility_name?: string }).facility_name,
              workspace.facilities.find((x) => x.id === f.facility_id)?.name,
            )}{" "}
            · {readable(f.role)} · {f.effective_from} –{" "}
            {f.effective_to || policy.expiration_date}
            <span className="block font-mono text-xs text-muted-foreground">
              Facility reference {f.facility_id}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VersionHistory({
  version,
  workspace,
}: {
  version: ServicingVersion;
  workspace: ServicingWorkspace;
}) {
  return (
    <details className="border-t border-border py-3">
      <summary className="cursor-pointer">
        Version {version.version} · {readable(version.event.action)} ·{" "}
        {new Date(version.created_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
        })}{" "}
        Eastern
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm">
          Recorded by{" "}
          {workspace.owners.find(
            (o) => o.id === (version.event.actor || version.actor_id),
          )?.name || "Authorized operator"}
        </p>
        {version.event.note && <p className="text-sm">{version.event.note}</p>}
        <ServicingRecordSummary
          record={version.snapshot}
          workspace={workspace}
        />
        {version.snapshot.kind === "renewal_package" &&
          ["approved", "shared", "acknowledged"].includes(
            version.snapshot.status,
          ) && (
            <PackageExport
              record={{ ...version.snapshot, version: version.version }}
            />
          )}
      </div>
    </details>
  );
}
function LossTotals({ workspace }: { workspace: ServicingWorkspace }) {
  const totals = workspace.loss_totals;
  return (
    <section className={panelClass}>
      <h2 className="text-lg font-semibold">
        Latest authoritative carrier figures
      </h2>
      <p className="text-sm">
        Newest approved, non-superseded valuation per claim. These figures are
        not client costs.{" "}
        {totals?.history_complete
          ? "Requested periods are confirmed complete."
          : "Reporting history is incomplete or not yet confirmed."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            "paid_cents",
            "reserve_cents",
            "recovery_cents",
            "expense_cents",
            "incurred_cents",
          ] as const
        ).map((key) => (
          <div key={key}>
            <h3 className="text-sm font-medium">
              {readable(key.replace("_cents", ""))}
            </h3>
            <p>{moneyLabel(totals?.[key]?.total_cents)}</p>
            {totals?.[key]?.missing_count > 0 && (
              <p className="text-xs text-muted-foreground">
                Known subtotal {moneyLabel(totals[key].known_subtotal_cents)};{" "}
                {totals[key].missing_count} unknown claim value(s).
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ServicingPrintPage() {
  const state = useServicingWorkspace();
  const params = useParams();
  const search = useSearchParams();
  const version = Number(search.get("version"));
  const record = state.data?.records.find((r) => r.id === params.id);
  const snapshot =
    record?.versions?.find((v) => v.version === version)?.snapshot ||
    (record?.version === version ? record : null);
  return (
    <ServicingShell title="Printable approved renewal package" state={state}>
      {state.data &&
        (snapshot?.kind === "renewal_package" &&
        ["approved", "shared", "acknowledged"].includes(snapshot.status) ? (
          <>
            <div className="print:hidden">
              <Button onClick={() => window.print()}>
                Print approved package
              </Button>
              <p className="mt-2 text-sm">
                Printing does not send this package or mark a handoff complete.
              </p>
            </div>
            <article id="insurance-package-print">
              <h1 className="mb-4 text-xl font-semibold">
                Approved renewal package · Version {version}
              </h1>
              <p className="mb-4 text-sm">
                Record reference {snapshot.id}; legal entity reference{" "}
                {snapshot.entity_id}. Prepared names, payload values and
                reference IDs come from this version. Any legacy name fallback
                is explicitly marked current.
              </p>
              <ServicingRecordSummary
                record={snapshot}
                workspace={state.data}
              />
            </article>
            <style>{`@media print { body * { visibility: hidden; } #insurance-package-print, #insurance-package-print * { visibility: visible; } #insurance-package-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
          </>
        ) : (
          <p>No approved package version is available for printing.</p>
        ))}
    </ServicingShell>
  );
}
