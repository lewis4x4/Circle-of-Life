"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  POLICY_TYPES,
  POLICY_FIELD_LABELS,
  createEmptyPolicyDraft,
  type InsuranceDraft,
  type InsuranceWorkspace,
  type PolicyDraft,
  type PolicyEvidence,
  type InsurancePolicy,
} from "@/lib/insurance/workspace-types";
import {
  Field,
  SourceDocument,
  controlClass,
  insuranceCommand,
  panelClass,
  readable,
} from "./workspace-client";

type EvidenceValue = PolicyEvidence[string];
const moneyFields = [
  "premium_cents",
  "aggregate_limit_cents",
  "occurrence_limit_cents",
  "deductible_cents",
] as const;
const criticalFields = [
  "entity_id",
  "policy_type",
  "carrier_name",
  "policy_number",
  "effective_date",
  "expiration_date",
];

function EvidenceInput({
  path,
  label,
  value,
  documents,
  onChange,
}: {
  path: string;
  label: string;
  value?: EvidenceValue;
  documents: InsuranceWorkspace["documents"];
  onChange: (value: EvidenceValue) => void;
}) {
  const source = value?.source || "manual";
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Evidence for {label}
        {value ? " · recorded" : " · needed for approval"}
      </summary>
      <div className="mt-3 space-y-3">
        <Field label={`${label} evidence source`}>
          <select
            className={controlClass}
            value={source}
            onChange={(e) =>
              onChange(
                e.target.value === "manual"
                  ? { source: "manual", reason: "" }
                  : { source: "document" },
              )
            }
          >
            <option value="manual">Human verification</option>
            <option value="document">Document page</option>
          </select>
        </Field>
        {source === "manual" ? (
          <Field
            label={`${label} verification reason`}
            hint="Describe how you established this value, including the source or conversation."
          >
            <textarea
              className={controlClass}
              value={value?.reason || ""}
              onChange={(e) =>
                onChange({ source: "manual", reason: e.target.value })
              }
            />
          </Field>
        ) : (
          <>
            <Field label={`${label} source document`}>
              <select
                className={controlClass}
                value={value?.document_id || ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    source: "document",
                    document_id: e.target.value || undefined,
                  })
                }
              >
                <option value="">Choose verified source file</option>
                {documents
                  .filter((d) => d.status === "ready")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={`${label} source page`}>
              <Input
                type="number"
                min={1}
                step={1}
                value={value?.page ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    source: "document",
                    page: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </Field>
            <Field label={`${label} source excerpt`}>
              <textarea
                className={controlClass}
                value={value?.excerpt || ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    source: "document",
                    excerpt: e.target.value,
                  })
                }
              />
            </Field>
          </>
        )}
        <span className="sr-only">Evidence field {path}</span>
      </div>
    </details>
  );
}

export function PolicyDraftEditor({
  workspace,
  draft,
  basePolicy,
  initialKind = "new_policy",
  documentId,
}: {
  workspace: InsuranceWorkspace;
  draft?: InsuranceDraft;
  basePolicy?: InsurancePolicy;
  initialKind?: InsuranceDraft["kind"];
  documentId?: string;
}) {
  const router = useRouter();
  const [id] = useState(() => draft?.id || crypto.randomUUID());
  const [revision, setRevision] = useState(draft?.revision);
  const [kind] = useState(draft?.kind || initialKind);
  const [payload, setPayload] = useState<PolicyDraft>(() => {
    const empty = createEmptyPolicyDraft();
    if (draft)
      return {
        ...empty,
        ...draft.payload,
        parties: draft.payload.parties || [],
        facilities: draft.payload.facilities || [],
      };
    if (!basePolicy) return empty;
    const p: PolicyDraft = Object.fromEntries(
      Object.keys(empty).map((k) => [
        k,
        basePolicy[k as keyof PolicyDraft] ?? empty[k as keyof PolicyDraft],
      ]),
    ) as PolicyDraft;
    p.parties = p.parties.map(
      ({ entity_id, role, effective_from, effective_to }) => ({
        entity_id,
        role,
        effective_from,
        effective_to,
      }),
    );
    p.facilities = p.facilities.map(
      ({ facility_id, role, effective_from, effective_to }) => ({
        facility_id,
        role,
        effective_from,
        effective_to,
      }),
    );
    p.coverages = (p.coverages || []).map(
      ({
        coverage_type,
        occurrence_limit_cents,
        aggregate_limit_cents,
        deductible_cents,
        shared_limit_group,
      }) => ({
        coverage_type,
        occurrence_limit_cents,
        aggregate_limit_cents,
        deductible_cents,
        shared_limit_group,
      }),
    );
    if (initialKind === "renewal")
      return {
        ...p,
        effective_date: "",
        expiration_date: "",
        parties: p.parties.map((x) => ({
          ...x,
          effective_from: "",
          effective_to: null,
        })),
        facilities: p.facilities.map((x) => ({
          ...x,
          effective_from: "",
          effective_to: null,
        })),
      };
    if (
      initialKind === "verification" &&
      basePolicy.verification_status !== "verified"
    )
      p.shared_limit = null;
    return p;
  });
  const [evidence, setEvidence] = useState<PolicyEvidence>(
    draft?.evidence || {},
  );
  const [approvalRevision, setApprovalRevision] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [sourcePage, setSourcePage] = useState<number>(1);
  const [sourceId, setSourceId] = useState(
    draft?.document_id || documentId || "",
  );
  const [moneyText, setMoneyText] = useState(
    () =>
      Object.fromEntries(
        moneyFields.map((k) => [
          k,
          (draft?.payload || basePolicy)?.[k] == null
            ? ""
            : String(((draft?.payload || basePolicy)![k] as number) / 100),
        ]),
      ) as Record<(typeof moneyFields)[number], string>,
  );
  const closed = draft && draft.status !== "draft";
  const policyId = draft?.policy_id || basePolicy?.id;
  const expectedVersion =
    draft?.expected_version ??
    basePolicy?.version ??
    (kind === "verification" ? 0 : undefined);
  const change = (next: PolicyDraft) => {
    setPayload(next);
    setConfirmed(false);
    setApprovalRevision(null);
    setMessage("");
  };
  const evidenceChange = (path: string, value: EvidenceValue) => {
    setEvidence((v) => ({ ...v, [path]: value }));
    setConfirmed(false);
    setApprovalRevision(null);
  };
  const evidenceFor = (path: string, label: string) => (
    <EvidenceInput
      path={path}
      label={label}
      value={evidence[path]}
      documents={workspace.documents}
      onChange={(value) => evidenceChange(path, value)}
    />
  );

  async function save(): Promise<InsuranceDraft> {
    const next = { ...payload };
    for (const key of moneyFields) {
      const text = moneyText[key].trim();
      if (!text) next[key] = null;
      else {
        if (!/^\d+(\.\d{1,2})?$/.test(text))
          throw new Error(
            `${POLICY_FIELD_LABELS[key]} must be a nonnegative dollar amount with at most two decimals.`,
          );
        const cents = Math.round(Number(text) * 100);
        if (!Number.isSafeInteger(cents) || cents > 2147483647)
          throw new Error(
            `${POLICY_FIELD_LABELS[key]} is outside the supported amount range.`,
          );
        next[key] = cents;
      }
    }
    const saved = await insuranceCommand<InsuranceDraft>("save_draft", {
      id,
      kind,
      ...(revision ? { revision } : {}),
      ...(draft?.document_id || documentId
        ? { document_id: draft?.document_id || documentId }
        : {}),
      ...(policyId
        ? { policy_id: policyId, expected_version: expectedVersion }
        : {}),
      payload: next,
      evidence,
    });
    setPayload(next);
    setRevision(saved.revision);
    setApprovalRevision(saved.revision);
    return saved;
  }
  async function act(action: "save" | "approve" | "reject") {
    if (busy) return;
    if (action === "approve" && !confirmed) {
      setError(
        "Confirm the critical facts and source evidence before approving.",
      );
      return;
    }
    if (action === "reject" && !reason.trim()) {
      setError("Enter a reason for rejecting this draft.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const savedRevision =
        action === "approve" && approvalRevision !== null
          ? approvalRevision
          : (await save()).revision;
      if (action === "approve") {
        const approved = await insuranceCommand<{ policy_id: string }>(
          "approve_draft",
          { id, revision: savedRevision, confirm_evidence: true },
        );
        router.push(`/admin/insurance/policies/${approved.policy_id}`);
      } else if (action === "reject") {
        await insuranceCommand("reject_draft", {
          id,
          revision: savedRevision,
          reason,
        });
        router.push("/admin/insurance/documents");
      } else {
        setMessage(
          "Draft saved. Insurance records remain unchanged until approval.",
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save the draft. Your edits are still here.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (closed)
    return (
      <p className={panelClass}>
        This draft is {draft.status}. Start a new amendment or renewal from the
        policy record to preserve its history.
      </p>
    );
  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-border bg-muted p-4 text-sm">
        {kind === "verification"
          ? "Verify this existing policy while retaining its claims, allocations and policy identity."
          : kind === "endorsement"
            ? "Dated endorsement: preserve the policy term and review the changed schedule."
            : kind === "renewal"
              ? "Renewal: this creates a separate linked term after approval."
              : "New policy draft: match the legal entities and facilities explicitly. An upload is not coverage verification."}{" "}
        Unknown amounts remain unknown.
      </p>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <aside className={`${panelClass} xl:sticky xl:top-4`}>
          <Field label="Review source">
            <select
              className={controlClass}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">Manual verification without a file</option>
              {workspace.documents
                .filter((d) => d.status === "ready")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
            </select>
          </Field>
          {sourceId ? (
            <>
              <Field label="Preview page">
                <Input
                  type="number"
                  min={1}
                  value={sourcePage}
                  onChange={(e) =>
                    setSourcePage(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </Field>
              <SourceDocument id={sourceId} page={sourcePage} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Record a human verification reason for each critical field. Attach
              supporting documents when available.
            </p>
          )}
        </aside>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void act("save");
          }}
        >
          <fieldset disabled={busy} className={panelClass}>
            <legend className="px-2 text-lg font-semibold">Policy facts</legend>
            <Field label="Primary named insured">
              <select
                className={controlClass}
                value={payload.entity_id}
                disabled={kind === "endorsement"}
                onChange={(e) =>
                  change({ ...payload, entity_id: e.target.value })
                }
              >
                <option value="">Choose the exact legal entity</option>
                {workspace.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
            {evidenceFor("entity_id", "Primary named insured")}
            <Field label="Coverage type">
              <select
                className={controlClass}
                value={payload.policy_type}
                disabled={kind === "endorsement"}
                onChange={(e) =>
                  change({
                    ...payload,
                    policy_type: e.target.value as PolicyDraft["policy_type"],
                  })
                }
              >
                {POLICY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {readable(t)}
                  </option>
                ))}
              </select>
            </Field>
            {evidenceFor("policy_type", "Coverage type")}
            {(
              [
                "carrier_name",
                "broker_name",
                "policy_number",
                "effective_date",
                "expiration_date",
                "premium_period",
              ] as const
            ).map((key) => (
              <div key={key} className="space-y-2">
                <Field label={POLICY_FIELD_LABELS[key]}>
                  <Input
                    type={key.endsWith("date") ? "date" : "text"}
                    disabled={
                      kind === "endorsement" &&
                      [
                        "carrier_name",
                        "policy_number",
                        "effective_date",
                        "expiration_date",
                      ].includes(key)
                    }
                    value={payload[key] || ""}
                    onChange={(e) =>
                      change({
                        ...payload,
                        [key]:
                          e.target.value ||
                          (key === "broker_name" || key === "premium_period"
                            ? null
                            : ""),
                      })
                    }
                  />
                </Field>
                {criticalFields.includes(key) &&
                  evidenceFor(key, POLICY_FIELD_LABELS[key])}
              </div>
            ))}
            {kind === "endorsement" && (
              <>
                <Field label="Change effective date">
                  <Input
                    type="date"
                    value={payload.change_effective_date || ""}
                    onChange={(e) =>
                      change({
                        ...payload,
                        change_effective_date: e.target.value || undefined,
                      })
                    }
                  />
                </Field>
                {evidenceFor("change_effective_date", "Change effective date")}
              </>
            )}
            {moneyFields.map((key) => (
              <div className="space-y-2" key={key}>
                <Field
                  label={`${POLICY_FIELD_LABELS[key]} (USD)`}
                  hint="Leave blank when unknown. Zero means an explicitly verified zero."
                >
                  <Input
                    inputMode="decimal"
                    value={moneyText[key]}
                    onChange={(e) => {
                      setMoneyText((v) => ({ ...v, [key]: e.target.value }));
                      setConfirmed(false);
                      setApprovalRevision(null);
                    }}
                  />
                </Field>
                {moneyText[key].trim() &&
                  evidenceFor(key, POLICY_FIELD_LABELS[key])}
              </div>
            ))}
            <Field label="Limit sharing">
              <select
                className={controlClass}
                value={
                  payload.shared_limit == null
                    ? "unknown"
                    : payload.shared_limit
                      ? "shared"
                      : "independent"
                }
                onChange={(e) =>
                  change({
                    ...payload,
                    shared_limit:
                      e.target.value === "unknown"
                        ? null
                        : e.target.value === "shared",
                  })
                }
              >
                <option value="unknown">Unknown — review required</option>
                <option value="shared">
                  Shared across insured entities or locations
                </option>
                <option value="independent">Not shared, as evidenced</option>
              </select>
            </Field>
            {evidenceFor("shared_limit", "Limit sharing")}
            <Field label="Policy notes">
              <textarea
                className={controlClass}
                value={payload.notes || ""}
                onChange={(e) =>
                  change({ ...payload, notes: e.target.value || null })
                }
              />
            </Field>
          </fieldset>
          <fieldset disabled={busy} className={panelClass}>
            <legend className="px-2 text-lg font-semibold">
              Additional coverage lines
            </legend>
            <p className="text-sm text-muted-foreground">
              For package policies, record each coverage line while keeping one
              policy term and one total premium.
            </p>
            {(payload.coverages || []).map((coverage, index) => (
              <div
                className="space-y-3 rounded-lg border border-border p-3"
                key={index}
              >
                <Field label={`Coverage line ${index + 1}`}>
                  <select
                    className={controlClass}
                    value={coverage.coverage_type}
                    onChange={(e) =>
                      change({
                        ...payload,
                        coverages: payload.coverages!.map((c, i) =>
                          i === index
                            ? {
                                ...c,
                                coverage_type: e.target
                                  .value as PolicyDraft["policy_type"],
                              }
                            : c,
                        ),
                      })
                    }
                  >
                    {POLICY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {readable(t)}
                      </option>
                    ))}
                  </select>
                </Field>
                {(
                  [
                    "occurrence_limit_cents",
                    "aggregate_limit_cents",
                    "deductible_cents",
                  ] as const
                ).map((key) => (
                  <Field
                    key={key}
                    label={`Coverage ${index + 1} ${POLICY_FIELD_LABELS[key]} (USD)`}
                    hint="Blank means unknown."
                  >
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={coverage[key] == null ? "" : coverage[key]! / 100}
                      onChange={(e) =>
                        change({
                          ...payload,
                          coverages: payload.coverages!.map((c, i) =>
                            i === index
                              ? {
                                  ...c,
                                  [key]:
                                    e.target.value === ""
                                      ? null
                                      : Math.round(
                                          Number(e.target.value) * 100,
                                        ),
                                }
                              : c,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
                <Field
                  label={`Coverage ${index + 1} shared limit group`}
                  hint="Use the same evidenced label for lines drawing on a shared limit; leave blank if unknown."
                >
                  <Input
                    value={coverage.shared_limit_group || ""}
                    onChange={(e) =>
                      change({
                        ...payload,
                        coverages: payload.coverages!.map((c, i) =>
                          i === index
                            ? {
                                ...c,
                                shared_limit_group: e.target.value || null,
                              }
                            : c,
                        ),
                      })
                    }
                  />
                </Field>
                {evidenceFor(
                  `coverages.${index}`,
                  `Coverage line ${index + 1}`,
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    change({
                      ...payload,
                      coverages: payload.coverages!.filter(
                        (_, i) => i !== index,
                      ),
                    });
                    setEvidence((v) =>
                      Object.fromEntries(
                        Object.entries(v).filter(
                          ([k]) => !k.startsWith("coverages."),
                        ),
                      ),
                    );
                  }}
                >
                  Remove coverage {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                change({
                  ...payload,
                  coverages: [
                    ...(payload.coverages || []),
                    {
                      coverage_type: "general_liability",
                      occurrence_limit_cents: null,
                      aggregate_limit_cents: null,
                      deductible_cents: null,
                      shared_limit_group: null,
                    },
                  ],
                })
              }
            >
              Add coverage line
            </Button>
          </fieldset>
          <fieldset disabled={busy} className={panelClass}>
            <legend className="px-2 text-lg font-semibold">
              Insured parties and dated relationships
            </legend>
            <p className="text-sm text-muted-foreground">
              Include the primary named insured. Affiliation alone does not
              establish coverage.
            </p>
            {payload.parties.map((party, index) => (
              <div
                key={index}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <Field label={`Party ${index + 1} legal entity`}>
                  <select
                    className={controlClass}
                    value={party.entity_id}
                    onChange={(e) =>
                      change({
                        ...payload,
                        parties: payload.parties.map((p, i) =>
                          i === index ? { ...p, entity_id: e.target.value } : p,
                        ),
                      })
                    }
                  >
                    {workspace.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <RelationshipFields
                  label={`Party ${index + 1}`}
                  value={party}
                  onChange={(patch) =>
                    change({
                      ...payload,
                      parties: payload.parties.map((p, i) =>
                        i === index ? { ...p, ...patch } : p,
                      ),
                    })
                  }
                />
                {evidenceFor(
                  `parties.${index}`,
                  `Party ${index + 1} relationship`,
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    change({
                      ...payload,
                      parties: payload.parties.filter((_, i) => i !== index),
                    });
                    setEvidence((v) =>
                      Object.fromEntries(
                        Object.entries(v).filter(
                          ([k]) => !k.startsWith("parties."),
                        ),
                      ),
                    );
                  }}
                >
                  Remove party {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={!workspace.entities.length}
              onClick={() =>
                change({
                  ...payload,
                  parties: [
                    ...payload.parties,
                    {
                      entity_id: payload.entity_id || workspace.entities[0].id,
                      role: payload.parties.length
                        ? "named_insured"
                        : "primary_named_insured",
                      effective_from:
                        kind === "endorsement"
                          ? payload.change_effective_date ||
                            payload.effective_date
                          : payload.effective_date,
                      effective_to: null,
                    },
                  ],
                })
              }
            >
              Add insured party
            </Button>
          </fieldset>
          <fieldset disabled={busy} className={panelClass}>
            <legend className="px-2 text-lg font-semibold">
              Facility schedule
            </legend>
            {payload.facilities.map((facility, index) => (
              <div
                key={index}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <Field label={`Location ${index + 1} facility`}>
                  <select
                    className={controlClass}
                    value={facility.facility_id}
                    onChange={(e) =>
                      change({
                        ...payload,
                        facilities: payload.facilities.map((p, i) =>
                          i === index
                            ? { ...p, facility_id: e.target.value }
                            : p,
                        ),
                      })
                    }
                  >
                    {workspace.facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <RelationshipFields
                  label={`Location ${index + 1}`}
                  value={facility}
                  onChange={(patch) =>
                    change({
                      ...payload,
                      facilities: payload.facilities.map((p, i) =>
                        i === index ? { ...p, ...patch } : p,
                      ),
                    })
                  }
                />
                {evidenceFor(
                  `facilities.${index}`,
                  `Location ${index + 1} relationship`,
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    change({
                      ...payload,
                      facilities: payload.facilities.filter(
                        (_, i) => i !== index,
                      ),
                    });
                    setEvidence((v) =>
                      Object.fromEntries(
                        Object.entries(v).filter(
                          ([k]) => !k.startsWith("facilities."),
                        ),
                      ),
                    );
                  }}
                >
                  Remove location {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={!workspace.facilities.length}
              onClick={() =>
                change({
                  ...payload,
                  facilities: [
                    ...payload.facilities,
                    {
                      facility_id: workspace.facilities[0].id,
                      role: "scheduled_location",
                      effective_from:
                        kind === "endorsement"
                          ? payload.change_effective_date ||
                            payload.effective_date
                          : payload.effective_date,
                      effective_to: null,
                    },
                  ],
                })
              }
            >
              Add facility
            </Button>
          </fieldset>
          <div className={panelClass}>
            <label className="flex items-start gap-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I reviewed the critical facts, exact legal names, dated location
                links, and their source evidence. I confirm this record is ready
                to publish.
              </span>
            </label>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                disabled={busy || !confirmed}
                onClick={(e) => {
                  if (e.currentTarget.form?.reportValidity())
                    void act("approve");
                }}
              >
                Approve and publish
              </Button>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">
                Reject this draft
              </summary>
              <div className="mt-3 space-y-3">
                <Field label="Rejection reason">
                  <textarea
                    className={controlClass}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !reason.trim()}
                  onClick={() => void act("reject")}
                >
                  Reject draft
                </Button>
              </div>
            </details>
          </div>
        </form>
      </div>
    </div>
  );
}

function RelationshipFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { role: string; effective_from: string; effective_to: string | null };
  onChange: (patch: Partial<typeof value>) => void;
}) {
  return (
    <>
      <Field label={`${label} role`}>
        <select
          className={controlClass}
          value={value.role}
          onChange={(e) => onChange({ role: e.target.value })}
        >
          {[
            "primary_named_insured",
            "named_insured",
            "additional_insured",
            "scheduled_location",
            "property_owner",
            "operator",
            "other",
          ].map((role) => (
            <option key={role} value={role}>
              {readable(role)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${label} effective from`}>
          <Input
            type="date"
            value={value.effective_from}
            onChange={(e) => onChange({ effective_from: e.target.value })}
          />
        </Field>
        <Field
          label={`${label} effective to`}
          hint="Blank means term expiration."
        >
          <Input
            type="date"
            value={value.effective_to || ""}
            onChange={(e) => onChange({ effective_to: e.target.value || null })}
          />
        </Field>
      </div>
    </>
  );
}
