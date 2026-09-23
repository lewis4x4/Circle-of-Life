"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-label";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  BENEFITS_PROGRAMS,
  type BenefitsCase,
  type BenefitsCaseList,
  type BenefitsOptions,
  type BenefitsRulesList,
} from "@/lib/benefits/contracts";
import { formatBenefitsQueueScopeSubtitle } from "@/lib/benefits/benefits-queue-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import {
  ActionForm,
  benefitsFetch,
  dateLabel,
  ErrorNotice,
  fieldClass,
  Panel,
  type Choice,
} from "./benefits-ui";
import { enumLabel } from "@/lib/display/enum-label";

export const programChoices: Choice[] = BENEFITS_PROGRAMS.map((value) => ({
  value,
  label:
    value === "smmc_ltc"
      ? "Medicaid long-term care"
      : value === "oss"
        ? "Optional State Supplementation"
        : "Other benefits",
}));
export const statusChoices: Choice[] = [
  { value: "open", label: "Needs staff action" },
  { value: "waiting", label: "Waiting on external response" },
  { value: "closed", label: "Closed" },
];
/** Days until a calendar date from the facility's today; negative when past. */
export function daysUntil(date: string | null | undefined, today: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}
export function renewalWarningDays(rules: BenefitsRulesList | null | undefined) {
  const value = rules?.rules?.find((rule) => rule.rule_key === "renewal.warning_days")?.value;
  return typeof value === "number" ? value : null;
}
/** What Jessica needs at a glance: is this case overdue, coming up for renewal, or attached to a resident who moved or left. */
export function caseFlags(item: BenefitsCase, today: string, warningDays: number | null) {
  const flags: Array<{ key: string; label: string; tone: "urgent" | "warn" | "info" }> = [];
  const due = daysUntil(item.due_date, today);
  if (item.status !== "closed" && due !== null && due < 0) flags.push({ key: "overdue", label: `Overdue by ${-due} day${due === -1 ? "" : "s"}`, tone: "urgent" });
  else if (item.status !== "closed" && due !== null && due <= 3) flags.push({ key: "due-soon", label: due === 0 ? "Due today" : `Due in ${due} day${due === 1 ? "" : "s"}`, tone: "warn" });
  const renewal = daysUntil(item.renewal_date, today);
  if (item.status !== "closed" && renewal !== null && warningDays !== null && renewal <= warningDays) flags.push({ key: "renewal", label: renewal < 0 ? `Renewal date passed ${-renewal} day${renewal === -1 ? "" : "s"} ago` : `Renewal due in ${renewal} day${renewal === 1 ? "" : "s"}`, tone: renewal < 0 ? "urgent" : "warn" });
  if (item.needs_rebind) flags.push({ key: "moved", label: `Resident moved to ${item.resident_facility_name || "another facility"}`, tone: "warn" });
  if (item.resident_status && ["discharged", "deceased"].includes(item.resident_status)) flags.push({ key: "resident", label: `Resident ${item.resident_status}`, tone: "info" });
  else if (item.resident_status && ["inquiry", "pending_admission"].includes(item.resident_status)) flags.push({ key: "prospect", label: "Not yet admitted", tone: "info" });
  if (item.assigned_to && item.assignee_active === false && item.status !== "closed") flags.push({ key: "assignee", label: "Assignee no longer has benefits access", tone: "warn" });
  return flags;
}
const toneClass = { urgent: "border-destructive text-destructive", warn: "border-foreground/40 text-foreground", info: "text-muted-foreground" } as const;
export function BenefitsQueue({
  residentId = "",
  admissionId = "",
}: {
  residentId?: string;
  admissionId?: string;
}) {
  const router = useRouter();
  const selectedFacilityId = useFacilityStore(
    (state) => state.selectedFacilityId,
  );
  const availableFacilities = useFacilityStore(
    (state) => state.availableFacilities,
  );
  const scopedFacilityName = useMemo(() => {
    if (!selectedFacilityId) return null;
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? null;
  }, [availableFacilities, selectedFacilityId]);
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<BenefitsOptions | null>(null);
  const [result, setResult] = useState<BenefitsCaseList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<BenefitsRulesList | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const today = todayFacilityDateIso();
  const warningDays = renewalWarningDays(rules);
  const sequence = useRef(0);
  const load = useCallback(
    async (before?: string) => {
      const current = ++sequence.current;
      setLoading(true);
      setError(null);
      if (!before) setResult(null);
      const query = new URLSearchParams({ limit: "50" });
      if (selectedFacilityId) query.set("facility_id", selectedFacilityId);
      if (residentId) query.set("resident_id", residentId);
      if (status) query.set("status", status);
      if (mine && actorId) query.set("assigned_to", actorId);
      if (before) query.set("before", before);
      try {
        const data = await benefitsFetch<BenefitsCaseList>(
          `/api/admin/benefits/cases?${query}`,
        );
        if (current === sequence.current)
          setResult((prior) => ({
            ...data,
            cases:
              before && prior ? [...prior.cases, ...data.cases] : data.cases,
          }));
      } catch (caught) {
        if (current === sequence.current)
          setError(
            caught instanceof Error ? caught.message : "Unable to load cases.",
          );
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [residentId, selectedFacilityId, status, mine, actorId],
  );
  useEffect(() => {
    void load();
    const invalidate = () => {
      sequence.current += 1;
    };
    return invalidate;
  }, [load]);
  useEffect(() => {
    let live = true;
    void benefitsFetch<BenefitsRulesList>("/api/admin/benefits/rules")
      .then((data) => {
        if (live) setRules(data && Array.isArray(data.rules) ? data : null);
      })
      .catch(() => {
        if (live) setRules(null);
      });
    return () => {
      live = false;
    };
  }, []);
  const startCase = async (residentIdToStart: string, program: string) => {
    setStarting(residentIdToStart);
    setStartError(null);
    try {
      const created = await benefitsFetch<{ case_id: string }>(
        "/api/admin/benefits/cases",
        {
          method: "POST",
          body: JSON.stringify({
            resident_id: residentIdToStart,
            program,
            request_id: crypto.randomUUID(),
          }),
        },
      );
      if (!created.case_id)
        throw new Error("The saved case could not be confirmed. Refresh before trying again.");
      router.push(`/admin/benefits/${created.case_id}`);
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Unable to start the case.");
    } finally {
      setStarting(null);
    }
  };
  useEffect(() => {
    let live = true;
    setOptions(null);
    const timer = setTimeout(() => {
      const query = new URLSearchParams();
      if (selectedFacilityId) query.set("facility_id", selectedFacilityId);
      if (search || residentId) query.set("query", search || residentId);
      void benefitsFetch<BenefitsOptions>(
        `/api/admin/benefits/options?${query}`,
      )
        .then((data) => {
          if (live) {
            setOptions(data);
            setOptionsError(null);
            if (data?.actor_id) setActorId(data.actor_id);
          }
        })
        .catch((caught) => {
          if (live)
            setOptionsError(
              caught instanceof Error
                ? caught.message
                : "Unable to load resident choices.",
            );
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [residentId, search, selectedFacilityId]);
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Medicaid &amp; Benefits</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Private case work across admissions, residency, and renewal.{" "}
            {formatBenefitsQueueScopeSubtitle(selectedFacilityId, scopedFacilityName)}
          </p>
        </div>
        {options?.can_manage_access && (
          <Link
            href="/admin/benefits/access"
            className={buttonVariants({
              variant: "outline",
              className: "min-h-11",
            })}
          >
            Manage benefits access
          </Link>
        )}
      </header>
      <Panel
        title="Case queue"
        description="Soonest due first; cases without a due date last. Each case shows its current next action; agency outcomes and funding evidence are reviewed within the case."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <FormLabel htmlFor="benefits-status">Work status</FormLabel>
            <select
              id="benefits-status"
              className={fieldClass}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {statusChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          {actorId && (
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={mine}
                onChange={(event) => setMine(event.target.checked)}
              />
              Assigned to me
            </label>
          )}
          <Button
            className="min-h-11"
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh queue
          </Button>
          {residentId && (
            <Link
              href={`/admin/residents/${residentId}`}
              className="p-3 text-sm underline"
            >
              Resident profile
            </Link>
          )}
        </div>
        <ErrorNotice error={error} />
        {loading && <p role="status">Loading benefits cases…</p>}
        {!loading && !error && result?.cases.length === 0 && (
          <p className="py-5 text-sm text-muted-foreground">
            No benefits cases match this view. Start a case below for an
            authorized resident.
          </p>
        )}
        {!error && result && (
          <ul className="divide-y divide-border">
            {result.cases.map((item) => (
              <li
                key={item.id}
                className="grid gap-3 py-5 sm:grid-cols-[1fr_2fr_auto]"
              >
                <div>
                  <Link
                    className="font-semibold underline underline-offset-4"
                    href={`/admin/benefits/${item.id}`}
                  >
                    {item.resident_name}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.facility_name} ·{" "}
                    {
                      programChoices.find(
                        (choice) => choice.value === item.program,
                      )?.label
                    }
                  </p>
                </div>
                <div>
                  <p className="text-sm">
                    {item.next_action || "Next action not recorded"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.assignee_name || "Unassigned"} · Due{" "}
                    {item.due_date ? dateLabel(item.due_date) : "not set"}
                  </p>
                </div>
                <div className="space-y-2">
                  <StatusPill tone={item.status === "open" ? "warning" : item.status === "waiting" ? "info" : "muted"}>
                    {
                      statusChoices.find(
                        (choice) => choice.value === item.status,
                      )?.label
                    }
                  </StatusPill>
                  {caseFlags(item, today, warningDays).map((flag) => (
                    <Badge
                      key={flag.key}
                      variant="outline"
                      className={`block w-fit ${toneClass[flag.tone]}`}
                    >
                      {flag.label}
                    </Badge>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Updated {dateLabel(item.updated_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!error && result?.next_cursor && (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={loading}
            onClick={() => void load(result.next_cursor!)}
          >
            Load more cases
          </Button>
        )}
      </Panel>
      {options?.uncased_medicaid_residents && options.uncased_medicaid_residents.length > 0 && (
        <Panel
          title="Medicaid residents without a benefits case"
          description="These residents already have a Medicaid payer on file but no active case, so their renewals and authorizations are not being tracked here yet."
        >
          <ErrorNotice error={startError} />
          <ul className="divide-y divide-border">
            {options.uncased_medicaid_residents!.map((resident) => (
              <li
                key={resident.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <Link
                    className="font-medium underline underline-offset-4"
                    href={`/admin/residents/${resident.id}`}
                  >
                    {resident.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {options.facilities.find((f) => f.id === resident.facility_id)?.name ?? "Facility"} ·{" "}
                    {enumLabel(resident.payer_type)}
                    {resident.medicaid_authorization_end
                      ? ` · authorization ends ${resident.medicaid_authorization_end}`
                      : " · no authorization end date on file"}
                  </p>
                </div>
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={starting !== null}
                  onClick={() => void startCase(resident.id, resident.suggested_program)}
                >
                  {starting === resident.id
                    ? "Starting…"
                    : `Start ${programChoices.find((c) => c.value === resident.suggested_program)?.label ?? "benefits"} case`}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel
        title="Start a benefits case"
        description="Use the existing resident record. An active case for the same program is kept together through move-in and ongoing residency."
      >
        <div className="max-w-md space-y-2">
          <FormLabel htmlFor="resident-search">Find resident by name</FormLabel>
          <Input
            id="resident-search"
            className="min-h-11"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search authorized residents"
          />
        </div>
        <ErrorNotice error={optionsError} />
        {!options && !optionsError && (
          <p role="status">Loading resident choices…</p>
        )}
        {options && (
          <ActionForm
            bare
            key={`${selectedFacilityId ?? "all"}:${residentId}`}
            title="Choose the resident and program"
            submitLabel="Open benefits case"
            fields={[
              {
                name: "resident_id",
                label: "Resident",
                type: "select",
                required: true,
                value: options.residents.some(
                  (resident) => resident.id === residentId,
                )
                  ? residentId
                  : "",
                options: options.residents.map((resident) => ({
                  value: resident.id,
                  label: resident.name,
                })),
              },
              {
                name: "program",
                label: "Program",
                type: "select",
                required: true,
                value: "smmc_ltc",
                options: programChoices,
              },
            ]}
            onSubmit={async (payload, requestId) => {
              const created = await benefitsFetch<{ case_id: string }>(
                "/api/admin/benefits/cases",
                {
                  method: "POST",
                  body: JSON.stringify({
                    ...payload,
                    ...(admissionId && payload.resident_id === residentId
                      ? { admission_case_id: admissionId }
                      : {}),
                    request_id: requestId,
                  }),
                },
              );
              const id = created.case_id;
              if (!id)
                throw new Error(
                  "The saved case could not be confirmed. Refresh the queue before trying again.",
                );
              router.push(`/admin/benefits/${id}`);
            }}
          />
        )}
      </Panel>
    </div>
  );
}
