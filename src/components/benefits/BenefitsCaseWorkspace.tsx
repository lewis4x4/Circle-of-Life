"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  BENEFITS_AGENCIES,
  BENEFITS_EVENT_TYPES,
  BENEFITS_STAGES,
  REQUIREMENT_STATUSES,
  type BenefitsCommand,
  type BenefitsDetail,
  type BenefitsOptions,
  type BenefitsRequirement,
  type BenefitsRulesList,
  type ScreeningStandard,
} from "@/lib/benefits/contracts";
import {
  ActionForm,
  benefitsFetch,
  BenefitsRequestError,
  dateLabel,
  ErrorNotice,
  label,
  Panel,
  type Choice,
  type Field,
} from "./benefits-ui";
import { programChoices, statusChoices } from "./BenefitsQueue";
import { BenefitsDocuments } from "./BenefitsDocuments";
import { BenefitsCollectionRequests } from "./BenefitsCollectionRequests";
import { BenefitsSubmissions } from "./BenefitsSubmissions";
import { benefitsScreeningReview } from "@/lib/benefits/screening";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

export function screeningStandardFromRules(
  rules: BenefitsRulesList | null | undefined,
): ScreeningStandard | null {
  const entry = rules?.rules?.find(
    (rule) => rule.rule_key === "screening.standard_individual",
  );
  const value = entry?.value as
    | { income_cents?: unknown; assets_cents?: unknown; label?: unknown; source?: unknown }
    | null
    | undefined;
  if (
    !value ||
    typeof value.income_cents !== "number" ||
    typeof value.assets_cents !== "number" ||
    typeof value.label !== "string"
  )
    return null;
  return {
    income_cents: value.income_cents,
    assets_cents: value.assets_cents,
    label: value.label,
    source: typeof value.source === "string" ? value.source : undefined,
    effective_from: entry?.current?.effective_from ?? null,
  };
}

export function statusTone(status: string): "warning" | "info" | "muted" {
  return status === "open" ? "warning" : status === "waiting" ? "info" : "muted";
}

type Command = (
  action: BenefitsCommand["action"],
  payload: Record<string, unknown>,
  requestId: string,
) => Promise<void>;
const choices = (values: readonly string[]): Choice[] =>
  values.map((value) => ({ value, label: label(value) }));
const knowledge = choices(["unknown", "yes", "no"]);
const nonNull = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null),
  );
const agencyNames: Record<string, string> = {
  elder_options: "Elder Options",
  cares: "CARES",
  dcf: "DCF",
  plan: "Health plan",
  other: "Other",
};
export function BenefitsCaseWorkspace({ id }: { id: string }) {
  const [detail, setDetail] = useState<BenefitsDetail | null>(null);
  const [options, setOptions] = useState<BenefitsOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [standard, setStandard] = useState<ScreeningStandard | null>(null);
  const selectedFacilityId = useFacilityStore(
    (state) => state.selectedFacilityId,
  );
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const base = `/api/admin/benefits/cases/${id}`;
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const data = await benefitsFetch<BenefitsDetail>(base);
      if (current === sequence.current) setDetail(data);
    } catch (caught) {
      if (current === sequence.current) {
        setDetail(null);
        setError(
          caught instanceof Error ? caught.message : "Unable to load case.",
        );
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    setDetail(null);
    void refresh();
    const invalidate = () => {
      sequence.current += 1;
    };
    return invalidate;
  }, [refresh, selectedFacilityId]);
  useEffect(() => {
    let live = true;
    void benefitsFetch<BenefitsRulesList>("/api/admin/benefits/rules")
      .then((rules) => {
        if (live) setStandard(screeningStandardFromRules(rules));
      })
      .catch(() => {
        if (live) setStandard(null);
      });
    return () => {
      live = false;
    };
  }, [id]);
  const facilityId = detail?.case.facility_id;
  useEffect(() => {
    if (!facilityId) return;
    let live = true;
    setOptions(null);
    void benefitsFetch<BenefitsOptions>(
      `/api/admin/benefits/options?facility_id=${facilityId}`,
    )
      .then((data) => {
        if (live) {
          setOptions(data);
          setOptionsError(null);
        }
      })
      .catch((caught) => {
        if (live)
          setOptionsError(
            caught instanceof Error
              ? caught.message
              : "Unable to load staff choices.",
          );
      });
    return () => {
      live = false;
    };
  }, [facilityId]);
  const command: Command = async (action, payload, requestId) => {
    if (!detail || busyRef.current)
      throw new Error(
        "Another change is being saved. Please wait and try again.",
      );
    busyRef.current = true;
    setMutating(true);
    try {
      await benefitsFetch(base + "/commands", {
        method: "POST",
        body: JSON.stringify({
          action,
          payload,
          request_id: requestId,
          expected_revision: detail.case.revision,
        }),
      });
      await refresh();
    } catch (caught) {
      // A conflict means the case moved under us: reload it so the next save carries the current revision.
      if (caught instanceof BenefitsRequestError && caught.status === 409) await refresh();
      throw caught;
    } finally {
      busyRef.current = false;
      setMutating(false);
    }
  };
  if (!detail)
    return (
      <div className="mx-auto max-w-6xl space-y-5 py-6">
        <Link href="/admin/benefits" className="underline">
          Back to benefits
        </Link>
        <h1 className="text-2xl font-semibold">Benefits case</h1>
        <ErrorNotice error={error} />
        {loading ? (
          <p role="status">Loading private case information…</p>
        ) : (
          <Button className="min-h-11" onClick={() => void refresh()}>
            Try again
          </Button>
        )}
      </div>
    );
  const item = detail.case;
  const permissions = detail.permissions;
  const disabled =
    mutating || loading || !permissions.can_write || item.status === "closed";
  const reviewDisabled =
    mutating || loading || !permissions.can_review || item.status === "closed";
  const assignees =
    options?.assignees
      .filter((person) => person.facility_id === item.facility_id)
      .map((person) => ({ value: person.id, label: person.name })) ??
    (item.assigned_to
      ? [
          {
            value: item.assigned_to,
            label: item.assignee_name || "Current assignee",
          },
        ]
      : []);
  const docs = detail.documents
    .filter((document) => document.status === "ready" && !document.voided_at)
    .map((document) => ({ value: document.id, label: document.filename }));
  const screeningReview = benefitsScreeningReview(
    item.program,
    item.screening,
    todayFacilityDateIso(),
    standard,
  );
  const residentAway =
    item.resident_status && ["discharged", "deceased"].includes(item.resident_status)
      ? item.resident_status
      : null;
  const sectionTabs = [
    "Overview",
    "Requirements & evidence",
    "Agency history",
    "Submissions",
    "Funding & renewal",
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24 pt-6">
      <Link
        href="/admin/benefits"
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        Back to benefits queue
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {item.resident_name} · Benefits
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.facility_name} ·{" "}
            {
              programChoices.find((choice) => choice.value === item.program)
                ?.label
            }
          </p>
          <StatusPill tone={statusTone(item.status)} className="mt-3">
            {
              statusChoices.find((choice) => choice.value === item.status)
                ?.label
            }
          </StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className={buttonVariants({
              variant: "outline",
              className: "min-h-11",
            })}
            href={`/admin/residents/${item.resident_id}`}
          >
            Resident profile
          </Link>
          {item.admission_case_id && (
            <Link
              className={buttonVariants({
                variant: "outline",
                className: "min-h-11",
              })}
              href={`/admin/admissions/${item.admission_case_id}`}
            >
              Admission
            </Link>
          )}
          <Button
            className="min-h-11"
            variant="outline"
            disabled={loading || mutating}
            onClick={() => void refresh()}
          >
            Refresh case
          </Button>
        </div>
      </header>
      <ErrorNotice error={error} />
      <ErrorNotice error={optionsError} />
      {loading && <p role="status">Refreshing case…</p>}
      {item.needs_rebind && (
        <Panel title="Resident has moved facilities">
          <p className="text-sm">
            {item.resident_name} is now at{" "}
            {item.resident_facility_name || "another facility"}, but this case
            is still filed under {item.facility_name}. The case stays readable
            and cannot be changed until someone with review authority on both
            facilities moves it with the resident.
          </p>
          <ActionForm
            bare
            title="Move the case with the resident"
            submitLabel="Rebind case to the resident’s facility"
            disabled={mutating || !permissions.can_review}
            fields={[]}
            onSubmit={async (_payload, requestId) => {
              await benefitsFetch(base + "/rebind", {
                method: "POST",
                body: JSON.stringify({ request_id: requestId }),
              });
              await refresh();
            }}
          />
        </Panel>
      )}
      {residentAway && (
        <p className="rounded-[var(--radius)] border border-border bg-muted/30 p-3 text-sm">
          Resident record status is <strong>{label(residentAway)}</strong>.
          Decide whether this case should be closed with a reason or kept open
          for a pending decision, appeal or final funding.
        </p>
      )}
      {!permissions.can_write && (
        <p className="text-sm text-muted-foreground">
          You have read access. A staff member with benefits write access can
          update this case.
        </p>
      )}
      {item.status === "closed" && (
        <Panel title="Case closed">
          <p>{item.closure_reason || "Closure reason not recorded"}</p>
          <p className="text-sm text-muted-foreground">
            History and evidence are retained. Reopening does not renew or
            confirm coverage.
          </p>
          <ActionForm
            bare
            title="Reopen case"
            submitLabel="Reopen for staff action"
            disabled={mutating || !permissions.can_write}
            fields={[
              {
                name: "next_action",
                label: "Reason and next action",
                required: true,
                type: "textarea",
              },
            ]}
            onSubmit={(payload, requestId) =>
              command(
                "update_case",
                { ...payload, status: "open", closure_reason: null },
                requestId,
              )
            }
          />
        </Panel>
      )}
      <div className="rounded-[var(--radius)] border border-border bg-muted/30 p-4">
        <p className="font-medium">
          {item.next_action || "Next action has not been recorded"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.assignee_name || "Unassigned"} · Due{" "}
          {item.due_date || "not set"} · Last recorded{" "}
          {dateLabel(item.updated_at)}
        </p>
      </div>
      <Tabs defaultValue="Overview">
        <div className="pb-2">
          <TabsList className="h-auto min-h-11 flex-wrap justify-start">
            {sectionTabs.map((name) => (
              <TabsTrigger
                key={name}
                value={name}
                className="min-h-11 px-3 text-foreground"
              >
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="Overview" className="space-y-5 pt-4">
          <ActionForm
            title="Next action and responsibility"
            disabled={disabled || !options}
            fields={[
              {
                name: "next_action",
                label: "Next action",
                type: "textarea",
                value: item.next_action,
              },
              {
                name: "assigned_to",
                label: "Responsible staff member",
                type: "select",
                options: assignees,
                value: item.assigned_to,
              },
              {
                name: "due_date",
                label: "Next action due",
                type: "date",
                value: item.due_date,
              },
              {
                name: "status",
                label: "Work status",
                type: "select",
                required: true,
                options: statusChoices.filter(
                  (choice) => choice.value !== "closed",
                ),
                value: item.status === "closed" ? "open" : item.status,
              },
            ]}
            onSubmit={(payload, requestId) =>
              command("update_case", payload, requestId)
            }
          />
          <Panel
            title="Review of saved screening facts"
            description="This advisory uses the last saved facts. Save screening changes to update it."
          >
            <p className="font-medium">{screeningReview.title}</p>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {screeningReview.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              {screeningReview.explanation}
            </p>
            {screeningReview.rule ? (
              screeningReview.rule.source ? (
                <a
                  className="inline-flex min-h-11 items-center text-sm underline"
                  href={screeningReview.rule.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  {screeningReview.rule.label} (in force from{" "}
                  {screeningReview.rule.effective_from ?? "the default"})
                </a>
              ) : (
                <p className="text-sm">
                  {screeningReview.rule.label} (in force from{" "}
                  {screeningReview.rule.effective_from ?? "the default"})
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                No financial screening standard is recorded. An owner can record
                one under Benefits access → Operating rules.
              </p>
            )}
          </Panel>
          <ActionForm
            title="Financial screening"
            description="Save partial facts. Unknown is different from no. Record the rule source and date used; these facts do not automatically determine eligibility."
            disabled={disabled}
            submitLabel="Save screening facts"
            fields={[
              {
                name: "income_cents",
                label: "Monthly income ($)",
                type: "money",
                value: item.screening.income_cents,
                help: "Leave blank when unknown.",
              },
              {
                name: "income_basis",
                label: "Income basis",
                type: "select",
                options: choices(["unknown", "gross", "countable"]),
                value: item.screening.income_basis ?? "unknown",
              },
              {
                name: "assets_cents",
                label: "Assets ($)",
                type: "money",
                value: item.screening.assets_cents,
              },
              ...(
                [
                  ["property", "Owns property"],
                  ["life_insurance", "Life insurance"],
                  ["burial", "Burial contract"],
                  ["power_of_attorney", "Power of attorney documented"],
                  ["married", "Married"],
                ] as const
              ).map(([name, title]) => ({
                name,
                label: title,
                type: "select" as const,
                options: knowledge,
                value: item.screening[name] ?? "unknown",
              })),
              {
                name: "rule_reference",
                label: "Rule source and effective date",
                value: item.screening.rule_reference,
              },
              {
                name: "notes",
                label: "Screening notes and exceptions",
                type: "textarea",
                value: item.screening.notes,
              },
            ]}
            onSubmit={(payload, requestId) =>
              command(
                "update_case",
                {
                  screening: {
                    ...nonNull(payload),
                    income_cents: payload.income_cents,
                    assets_cents: payload.assets_cents,
                    notes: payload.notes ?? "",
                    rule_reference: payload.rule_reference ?? "",
                  },
                },
                requestId,
              )
            }
          />
          <details className="rounded-[var(--radius)] border border-border p-4">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              Close this case
            </summary>
            <div className="pt-4">
              <ActionForm
                bare
                title="Close case"
                description="Close only when case work has ended. History and evidence are retained; reopening does not renew or confirm coverage."
                disabled={disabled}
                submitLabel="Close case and retain history"
                fields={[
                  {
                    name: "closure_reason",
                    label: "Closure reason",
                    type: "textarea",
                    required: true,
                  },
                ]}
                onSubmit={(payload, requestId) =>
                  command(
                    "update_case",
                    { ...payload, status: "closed" },
                    requestId,
                  )
                }
              />
            </div>
          </details>
          <Panel title="Recorded activity">
            <ul className="divide-y divide-border">
              {detail.history.map((entry) => (
                <li key={entry.id} className="py-3 text-sm">
                  {label(entry.action)} · Revision {entry.revision}
                  <p className="text-muted-foreground">
                    Recorded {dateLabel(entry.created_at)}
                  </p>
                </li>
              ))}
            </ul>
            {!detail.history.length && <p>No activity recorded.</p>}
            {"history_has_more" in detail &&
              detail.history_has_more === true && (
                <p className="text-sm text-muted-foreground">
                  Latest 200 events shown; older history is retained in the
                  audit record.
                </p>
              )}
          </Panel>
        </TabsContent>
        <TabsContent value="Requirements & evidence" className="space-y-5 pt-4">
          <BenefitsDocuments
            detail={detail}
            refresh={refresh}
            disabled={disabled}
            canReview={permissions.can_review && item.status !== "closed"}
            command={command}
          />
          <BenefitsCollectionRequests detail={detail} onChanged={refresh} />
          <RequirementForm
            assignees={assignees}
            docs={docs}
            disabled={disabled || !options}
            canReview={permissions.can_review}
            command={command}
          />
          {detail.requirements.map((requirement) => (
            <details
              key={requirement.id}
              className="rounded-[var(--radius)] border border-border p-4"
            >
              <summary className="min-h-11 cursor-pointer font-medium">
                {requirement.title} · {label(requirement.status)}
                <span className="block text-sm font-normal text-muted-foreground">
                  {label(requirement.stage)} ·{" "}
                  {requirement.assignee_name ||
                    assignees.find(
                      (person) => person.value === requirement.assigned_to,
                    )?.label ||
                    "Unassigned"}{" "}
                  · Due {requirement.due_date ? dateLabel(requirement.due_date) : "not set"}
                  {requirement.signed_on && ` · Signed ${dateLabel(requirement.signed_on)}`}
                </span>
              </summary>
              <div className="pt-4">
                <RequirementForm
                  requirement={requirement}
                  assignees={assignees}
                  docs={docs}
                  disabled={disabled || !options}
                  canReview={permissions.can_review}
                  command={command}
                />
                {requirement.reviewed_at && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Reviewed {dateLabel(requirement.reviewed_at)}
                  </p>
                )}
              </div>
            </details>
          ))}
          {!detail.requirements.length && (
            <p className="text-sm text-muted-foreground">
              No requirements recorded. Add the requirements for this resident
              and submission stage.
            </p>
          )}
        </TabsContent>
        <TabsContent value="Agency history" className="space-y-5 pt-4">
          <ActionForm
            title="Record agency outcome or correspondence"
            description="Keep screening, CARES eligibility, DCF eligibility, enrollment, and authorization separate. Record the source date as printed; Haven records the entry time separately. Record a notice review only after an authorized issuer has actually reviewed it."
            disabled={disabled}
            submitLabel="Record agency event"
            fields={[
              {
                name: "agency",
                label: "Agency",
                type: "select",
                required: true,
                options: BENEFITS_AGENCIES.map((value) => ({
                  value,
                  label: agencyNames[value],
                })),
              },
              {
                name: "event_type",
                label: "Event",
                type: "select",
                required: true,
                options: choices(BENEFITS_EVENT_TYPES),
              },
              {
                name: "outcome",
                label: "Outcome",
                type: "select",
                options: choices([
                  "requested",
                  "pending",
                  "waitlisted",
                  "approved",
                  "eligible",
                  "enrolled",
                  "active",
                  "authorized",
                  "completed",
                  "denied",
                  "withdrawn",
                  "other",
                ]),
                required: true,
              },
              {
                name: "occurred_on",
                label: "Source event date",
                type: "date",
                required: true,
              },
              {
                name: "due_date",
                label: "Response or appeal deadline",
                type: "date",
              },
              {
                name: "document_id",
                label: "Source evidence",
                type: "select",
                options: docs,
              },
              {
                name: "source_reference",
                label: "Agency reference or contact",
              },
              {
                name: "formal_decision",
                label: "Type of record",
                type: "select",
                value: "false",
                required: true,
                options: [
                  { value: "false", label: "Working note / correspondence" },
                  {
                    value: "true",
                    label: "Formal decision supported by source evidence",
                  },
                ],
              },
              {
                name: "notes",
                label:
                  "Notes, screening score, requested items, or issuer and reviewer",
                type: "textarea",
              },
            ]}
            onSubmit={(payload, requestId) =>
              command(
                "record_event",
                {
                  ...nonNull(payload),
                  formal_decision: payload.formal_decision === "true",
                },
                requestId,
              )
            }
          />
          <Panel title="Agency history and deadlines">
            {!detail.events.length && (
              <p className="text-muted-foreground">
                No agency events recorded.
              </p>
            )}
            <ul className="divide-y divide-border">
              {detail.events.map((event) => (
                <li key={event.id} className="space-y-2 py-4">
                  <p className="font-medium">
                    {agencyNames[event.agency]} · {label(event.event_type)} ·{" "}
                    {event.outcome}
                  </p>
                  <p className="text-sm">
                    Source date {dateLabel(event.occurred_on)}
                    {event.due_date ? ` · Response due ${event.due_date}` : ""}
                  </p>
                  {event.notes && (
                    <p className="whitespace-pre-wrap text-sm">{event.notes}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {event.formal_decision
                      ? "Formal source decision"
                      : "Working record"}{" "}
                    · {event.source_reference || "No external reference"} ·
                    Recorded {dateLabel(event.created_at)}
                  </p>
                  {event.document_id && (
                    <a
                      className="inline-flex min-h-11 items-center underline"
                      href={`${base}/documents/${event.document_id}`}
                      download
                    >
                      Download source evidence
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </TabsContent>
        <TabsContent value="Submissions" className="space-y-5 pt-4">
          <BenefitsSubmissions
            detail={detail}
            command={command}
            disabled={disabled}
          />
        </TabsContent>
        <TabsContent value="Funding & renewal" className="space-y-5 pt-4">
          <FundingForm
            detail={detail}
            disabled={disabled}
            reviewDisabled={reviewDisabled}
            command={command}
          />
          <Panel title="Billing handoff">
            <p className="text-sm">
              Funding facts do not change invoices or payer records. Authorized
              billing staff review the evidence and effective dates in the
              resident billing workflow.
            </p>
            <p className="text-sm">
              Handoff status: {label(item.funding.status ?? "unverified")}
            </p>
            <Link
              href={`/admin/residents/${item.resident_id}/billing`}
              className={buttonVariants({
                variant: "outline",
                className: "min-h-11",
              })}
            >
              Open resident billing
            </Link>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
function RequirementForm({
  requirement,
  assignees,
  docs,
  disabled,
  canReview,
  command,
}: {
  requirement?: BenefitsRequirement;
  assignees: Choice[];
  docs: Choice[];
  disabled: boolean;
  canReview: boolean;
  command: Command;
}) {
  const fields: Field[] = [
    {
      name: "title",
      label: "Requirement",
      required: true,
      value: requirement?.title,
    },
    {
      name: "stage",
      label: "Required for stage",
      type: "select",
      required: true,
      options: choices(BENEFITS_STAGES),
      value: requirement?.stage ?? "application",
    },
    {
      name: "status",
      label: "Document review status",
      type: "select",
      required: true,
      options: choices(
        REQUIREMENT_STATUSES.filter(
          (status) =>
            canReview ||
            !["accepted", "rejected", "not_applicable", "expired"].includes(status),
        ),
      ),
      value: requirement?.status ?? "missing",
    },
    {
      name: "assigned_to",
      label: "Responsible staff member",
      type: "select",
      options: assignees,
      value: requirement?.assigned_to,
    },
    {
      name: "due_date",
      label: "Due date",
      type: "date",
      value: requirement?.due_date,
    },
    {
      name: "document_id",
      label: "Evidence to review",
      type: "select",
      options: docs,
      value: requirement?.document_id,
    },
    {
      name: "signature_status",
      label: "Signature review",
      type: "select",
      required: true,
      value: requirement?.signature_status ?? "not_required",
      options: [
        { value: "not_required", label: "Not required for this evidence" },
        { value: "pending", label: "Required, awaiting verification" },
        ...(canReview
          ? [
              {
                value: "verified",
                label: "Actual signature and authority verified",
              },
            ]
          : []),
      ],
    },
    ...(canReview
      ? [
          {
            name: "signed_on",
            label: "Date actually signed (required when verified)",
            type: "date" as const,
            value: requirement?.signed_on,
          },
        ]
      : []),
    {
      name: "review_reason",
      label: "Review reason, expiry or not-applicable explanation",
      type: "textarea",
      value: requirement?.review_reason,
    },
    {
      name: "notes",
      label: "Document request details",
      type: "textarea",
      value: requirement?.notes,
    },
  ];
  return (
    <ActionForm
      title={requirement ? "Update requirement" : "Add document requirement"}
      description="Receipt and acceptance are separate. A reviewer must verify the evidence and any required actual signatures before accepting it."
      fields={fields}
      disabled={
        disabled ||
        Boolean(
          requirement &&
          !canReview &&
          ["accepted", "rejected", "not_applicable"].includes(
            requirement.status,
          ),
        )
      }
      submitLabel={requirement ? "Save requirement" : "Add requirement"}
      onSubmit={(payload, requestId) =>
        command(
          "upsert_requirement",
          { ...payload, ...(requirement ? { id: requirement.id } : {}) },
          requestId,
        )
      }
    />
  );
}
function FundingForm({
  detail,
  disabled,
  reviewDisabled,
  command,
}: {
  detail: BenefitsDetail;
  disabled: boolean;
  reviewDisabled: boolean;
  command: Command;
}) {
  const funding = detail.case.funding;
  const [selected, setSelected] = useState<string[]>(
    funding.evidence_event_ids ?? [],
  );
  const fields: Field[] = [
    { name: "plan", label: "Health plan", value: funding.plan },
    {
      name: "reference",
      label: "Coverage or authorization reference",
      value: funding.reference,
    },
    {
      name: "coverage_start",
      label: "Coverage starts",
      type: "date",
      value: funding.coverage_start,
    },
    {
      name: "coverage_end",
      label: "Coverage ends",
      type: "date",
      value: funding.coverage_end,
    },
    {
      name: "renewal_date",
      label: "Renewal due",
      type: "date",
      value: funding.renewal_date,
    },
    {
      name: "resident_contribution_cents",
      label: "Resident contribution ($)",
      type: "money",
      value: funding.resident_contribution_cents,
    },
    {
      name: "expected_benefit_cents",
      label: "Expected benefit ($)",
      type: "money",
      value: funding.expected_benefit_cents,
    },
    {
      name: "status",
      label: "Funding review",
      type: "select",
      required: true,
      value: funding.status ?? "unverified",
      options: [
        { value: "unverified", label: "Unverified / draft" },
        ...(!reviewDisabled
          ? [{ value: "reviewed", label: "Reviewed source evidence" }]
          : []),
      ],
    },
    {
      name: "notes",
      label: "Funding notes and renewal follow-up",
      type: "textarea",
      value: funding.notes,
    },
  ];
  return (
    <div className="space-y-4">
      <Panel
        title="Funding source evidence"
        description="Select formal source decisions supporting the handoff. Medicaid long-term care requires DCF eligibility, CARES assessment or eligibility, plan enrollment, and plan authorization, each with an affirmative recorded outcome and source evidence."
      >
        <fieldset disabled={disabled} className="space-y-2">
          {detail.events
            .filter((event) => event.formal_decision && event.document_id)
            .map((event) => (
              <label
                key={event.id}
                className="flex min-h-11 items-center gap-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(event.id)}
                  onChange={(change) =>
                    setSelected((current) =>
                      change.target.checked
                        ? [...current, event.id]
                        : current.filter((id) => id !== event.id),
                    )
                  }
                />
                {agencyNames[event.agency]} · {label(event.event_type)} ·{" "}
                {event.outcome} · {event.occurred_on}
              </label>
            ))}
          {!detail.events.some(
            (event) => event.formal_decision && event.document_id,
          ) && (
            <p className="text-sm text-muted-foreground">
              No formal decisions with evidence recorded yet. Save funding as
              unverified while collecting evidence.
            </p>
          )}
        </fieldset>
      </Panel>
      <ActionForm
        title="Funding facts and renewal"
        description="Record confirmed effective dates from the source. Expected benefits are not received payments. Use the case next action and a requirement to assign renewal work."
        disabled={
          disabled || Boolean(funding.status === "reviewed" && reviewDisabled)
        }
        fields={fields}
        submitLabel="Save funding handoff"
        onSubmit={(payload, requestId) =>
          command(
            "update_case",
            {
              funding: {
                ...payload,
                plan: payload.plan ?? "",
                reference: payload.reference ?? "",
                notes: payload.notes ?? "",
                evidence_event_ids: selected,
              },
            },
            requestId,
          )
        }
      />
    </div>
  );
}
