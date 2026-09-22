"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-label";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  BENEFITS_PROGRAMS,
  type BenefitsCaseList,
  type BenefitsOptions,
} from "@/lib/benefits/contracts";
import {
  ActionForm,
  benefitsFetch,
  dateLabel,
  ErrorNotice,
  fieldClass,
  Panel,
  type Choice,
} from "./benefits-ui";

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
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<BenefitsOptions | null>(null);
  const [result, setResult] = useState<BenefitsCaseList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    [residentId, selectedFacilityId, status],
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
            {selectedFacilityId
              ? "Showing the selected facility."
              : "Showing facilities you are authorized to access."}
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
        description="Each case shows its current next action. Agency outcomes and funding evidence are reviewed within the case."
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
                    {item.due_date || "not set"}
                  </p>
                </div>
                <div className="space-y-2">
                  <Badge variant="outline">
                    {
                      statusChoices.find(
                        (choice) => choice.value === item.status,
                      )?.label
                    }
                  </Badge>
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
      <section className="space-y-4" aria-label="Start a benefits case">
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
            key={`${selectedFacilityId ?? "all"}:${residentId}`}
            title="Start a benefits case"
            description="Use the existing resident record. An active case for the same program is kept together through move-in and ongoing residency."
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
      </section>
    </div>
  );
}
