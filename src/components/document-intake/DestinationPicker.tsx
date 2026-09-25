"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import type { Candidate, CatalogRow } from "@/lib/document-intake/contracts";
import { enumLabel } from "@/lib/display/enum-label";

import {
  intakeClient,
  loadRequirements,
  searchMedicaidCases,
  searchResidents,
  searchStaff,
  type RequirementOption,
} from "./data";
import { ambiguousCandidateIndexes, candidateFitsCatalog, namesNeedingDisambiguation, NO_REQUIREMENT_MESSAGE, SUBJECT_NOUN, type SubjectChoice } from "./destination";
import { FIELD_CLASS } from "./IntakeDialogs";

type Option = { id: string; label: string; detail: string | null };

const dob = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

async function searchSubjects(catalog: CatalogRow, facilityId: string, query: string): Promise<{ rows: Option[]; forbidden: boolean }> {
  const sb = intakeClient();
  if (catalog.subject_kind === "resident") {
    const result = await searchResidents(sb, facilityId, query);
    const shared = namesNeedingDisambiguation(result.rows.map((r) => r.name));
    return {
      forbidden: result.forbidden,
      rows: result.rows.map((r) => ({
        id: r.id,
        label: r.room ? `${r.name} — Room ${r.room}` : r.name,
        detail: [
          shared.has(r.name.trim().toLowerCase()) && r.dateOfBirth ? `Born ${dob.format(new Date(`${r.dateOfBirth}T00:00:00Z`))}` : null,
          r.status && r.status !== "active" ? enumLabel(r.status) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      })),
    };
  }
  if (catalog.subject_kind === "staff") {
    const result = await searchStaff(sb, facilityId, query);
    return { forbidden: result.forbidden, rows: result.rows.map((r) => ({ id: r.id, label: r.name, detail: r.role ? enumLabel(r.role) : null })) };
  }
  if (catalog.subject_kind === "medicaid_case") {
    const result = await searchMedicaidCases(facilityId, query);
    return {
      forbidden: result.forbidden,
      rows: result.rows.map((r) => ({ id: r.id, label: r.name, detail: `${r.program === "smmc_ltc" ? "Medicaid long-term care" : r.program === "oss" ? "Optional State Supplementation" : "Other benefits"} · ${enumLabel(r.status)}` })),
    };
  }
  return { rows: [], forbidden: false };
}

export function DestinationPicker({
  catalog,
  facilityId,
  facilityName,
  candidates,
  subject,
  onSubjectChange,
  requirementId,
  onRequirementChange,
  onRequirementRequired,
  disabled,
}: {
  catalog: CatalogRow | null;
  facilityId: string | null;
  facilityName: string;
  candidates: readonly Candidate[];
  subject: SubjectChoice | null;
  onSubjectChange: (subject: SubjectChoice | null) => void;
  requirementId: string | null;
  onRequirementChange: (id: string | null) => void;
  onRequirementRequired: (required: boolean) => void;
  disabled: boolean;
}) {
  const searchId = useId();
  const requirementFieldId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<{ rows: RequirementOption[]; forbidden: boolean } | null>(null);

  const kind = catalog?.subject_kind ?? "none";
  const searchable = kind === "resident" || kind === "staff" || kind === "medicaid_case";
  const ambiguous = useMemo(() => ambiguousCandidateIndexes(candidates), [candidates]);
  const fitting = candidates.map((c, index) => ({ c, index })).filter(({ c }) => candidateFitsCatalog(c, catalog));

  useEffect(() => {
    if (!catalog || !facilityId || !searchable) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchSubjects(catalog, facilityId, query)
        .then((result) => {
          if (!live) return;
          setResults(result.rows);
          setForbidden(result.forbidden);
          setSearchError(null);
        })
        .catch((cause) => live && setSearchError(cause instanceof Error ? cause.message : "Search did not work. Try again."));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [catalog, facilityId, query, searchable]);

  useEffect(() => {
    if (!catalog || catalog.destination_kind !== "employee_file" || !facilityId) {
      setRequirements(null);
      return;
    }
    let live = true;
    loadRequirements(intakeClient(), facilityId)
      .then((r) => live && setRequirements(r))
      .catch(() => live && setRequirements({ rows: [], forbidden: false }));
    return () => {
      live = false;
    };
  }, [catalog, facilityId]);

  const matchingRequirements = requirements?.rows.filter((r) => r.category === catalog?.destination_category) ?? [];
  const noMatchingRequirement = !!requirements && !requirements.forbidden && matchingRequirements.length === 0;

  useEffect(() => {
    onRequirementRequired(catalog?.destination_kind === "employee_file" && noMatchingRequirement);
  }, [catalog, noMatchingRequirement, onRequirementRequired]);

  if (!catalog) {
    return <p className="text-sm text-muted-foreground">Pick a document type to choose where it files.</p>;
  }
  if (catalog.destination_kind === "none") {
    return (
      <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-foreground">
        This type has no filing destination. It stays here, owned by the reviewer, until someone records it where it belongs.
      </p>
    );
  }
  if (catalog.subject_kind === "facility") {
    return <p className="text-sm text-foreground">Files to {facilityName}’s facility documents.</p>;
  }

  const noun = SUBJECT_NOUN[kind];

  return (
    <div className="grid gap-3">
      {fitting.length ? (
        <fieldset className="grid gap-1" disabled={disabled}>
          <legend className="mb-1 text-xs font-semibold text-muted-foreground">Suggested</legend>
          {fitting.map(({ c, index }) => (
            <label key={`${c.subject_id}-${index}`} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input
                type="radio"
                name="intake-destination"
                className="mt-1"
                checked={subject?.subject_id === c.subject_id}
                onChange={() => onSubjectChange({ subject_id: c.subject_id!, label: c.label, requirement_id: c.requirement_id ?? null })}
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{c.label}</span>
                {c.reason ? <span className="block text-xs text-muted-foreground">{c.reason}</span> : null}
                {ambiguous.has(index) ? <span className="block text-xs font-medium text-warning">Same name as another suggestion. Check the document before picking.</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {searchable ? (
        <div className="grid gap-1">
          <FormLabel htmlFor={searchId}>Find a {noun}</FormLabel>
          <Input id={searchId} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" disabled={disabled} />
          {forbidden ? (
            <p className="text-sm text-foreground">You can’t file this type.</p>
          ) : searchError ? (
            <p className="text-sm text-destructive">{searchError}</p>
          ) : results == null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No {noun} at this facility matches.</p>
          ) : (
            <fieldset className="grid max-h-64 gap-1 overflow-y-auto" disabled={disabled}>
              <legend className="sr-only">{`Matching ${noun}s`}</legend>
              {results.map((r) => (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input type="radio" name="intake-destination" className="mt-1" checked={subject?.subject_id === r.id} onChange={() => onSubjectChange({ subject_id: r.id, label: r.label })} />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{r.label}</span>
                    {r.detail ? <span className="block text-xs text-muted-foreground">{r.detail}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      ) : null}

      {catalog.destination_kind === "employee_file" ? (
        <div className="grid gap-1">
          <FormLabel htmlFor={requirementFieldId}>Staff file requirement (optional)</FormLabel>
          {requirements?.forbidden ? (
            <p className="text-sm text-foreground">You can’t file this type.</p>
          ) : (
            <>
              <select
                id={requirementFieldId}
                className={FIELD_CLASS}
                value={requirementId ?? ""}
                onChange={(e) => onRequirementChange(e.target.value || null)}
                disabled={disabled || !requirements}
              >
                <option value="">{noMatchingRequirement ? "No requirement picked" : "Use the first requirement of this kind"}</option>
                {matchingRequirements.length ? (
                  <optgroup label="This kind">
                    {matchingRequirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="Other requirements">
                  {(requirements?.rows ?? [])
                    .filter((r) => r.category !== catalog.destination_category)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} ({enumLabel(r.category)})
                      </option>
                    ))}
                </optgroup>
              </select>
              {noMatchingRequirement ? (
                <p className="text-sm text-foreground">{NO_REQUIREMENT_MESSAGE}.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
