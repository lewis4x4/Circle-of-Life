"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, ShieldAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FilterPill, type FilterPillTone } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  formatForm1823AlignmentEmptyRosterCopy,
  formatForm1823AlignmentFacilityTitle,
} from "@/lib/care-plans/form-1823-alignment-display-copy";

import { FORM_1823_MAX_AGE_YEARS } from "@/lib/care-plans/form-1823-alignment";
import {
  fetchForm1823AlignmentRoster,
  type Form1823AlignmentCounts,
  type Form1823AlignmentRoster,
  type Form1823AlignmentRosterRow,
  type Form1823RowAlignmentState,
} from "@/lib/care-plans/form-1823-alignment-roster";
import { cn } from "@/lib/utils";

type Props = {
  initialRoster: Form1823AlignmentRoster | null;
  initialError: string | null;
  initialFacilityId: string | null;
};

type DocumentFilter = "all" | "not_recorded" | "recorded" | "stale";
type PlanFilter = "all" | "none" | "active";
type AlignmentFilter = "all" | Form1823RowAlignmentState;

type Filters = { document: DocumentFilter; plan: PlanFilter; alignment: AlignmentFilter };

const NO_FILTERS: Filters = { document: "all", plan: "all", alignment: "all" };

/** Copy that says exactly what Haven can know: the record is not in Haven, not that it does not exist. */
export const FORM_1823_NOT_RECORDED_COPY = "Not recorded in Haven";

const ALIGNMENT_COPY: Record<Form1823RowAlignmentState, { label: string; tone: StatusPillTone }> = {
  cannot_assess: { label: "Cannot assess", tone: "muted" },
  no_plan: { label: "No plan to compare", tone: "muted" },
  gaps: { label: "Needs unanswered", tone: "warning" },
  answered: { label: "Answers the 1823", tone: "muted" },
};

function alignmentLabel(row: Form1823AlignmentRosterRow): string {
  if (row.alignment === "gaps") return `${row.gaps.length} need${row.gaps.length === 1 ? "" : "s"} unanswered`;
  return ALIGNMENT_COPY[row.alignment].label;
}

function alignmentDetail(row: Form1823AlignmentRosterRow): string | null {
  switch (row.alignment) {
    case "cannot_assess":
      return "No Form 1823 to compare the plan against";
    case "no_plan":
      return "A 1823 is recorded; nothing answers it yet";
    case "gaps":
      return row.gaps.join(", ");
    case "answered":
      return row.summary && row.summary.notAssessed > 0
        ? `${row.summary.addressed} addressed · ${row.summary.notAssessed} not assessed on the 1823`
        : `${row.summary?.addressed ?? 0} addressed`;
  }
}

function formTone(row: Form1823AlignmentRosterRow): StatusPillTone {
  if (!row.form1823) return "danger";
  if (row.form1823.age === "expired" || row.form1823.age === "over_age") return "warning";
  return "muted";
}

function formLabel(row: Form1823AlignmentRosterRow): string {
  if (!row.form1823) return FORM_1823_NOT_RECORDED_COPY;
  switch (row.form1823.age) {
    case "expired":
      return "Expired";
    case "over_age":
      return `Older than ${FORM_1823_MAX_AGE_YEARS} years`;
    case "unknown":
      return "Recorded, exam date missing";
    default:
      return "Recorded";
  }
}

function planLabel(row: Form1823AlignmentRosterRow): string {
  return row.plan ? `Active · v${row.plan.version ?? "?"}` : "No active plan";
}

function matchesFilters(row: Form1823AlignmentRosterRow, filters: Filters, query: string): boolean {
  if (query && !row.residentName.toLowerCase().includes(query)) return false;
  switch (filters.document) {
    case "not_recorded":
      if (row.form1823 !== null) return false;
      break;
    case "recorded":
      if (row.form1823 === null) return false;
      break;
    case "stale":
      if (!row.form1823 || (row.form1823.age !== "expired" && row.form1823.age !== "over_age")) return false;
      break;
  }
  if (filters.plan === "none" && row.plan !== null) return false;
  if (filters.plan === "active" && row.plan === null) return false;
  if (filters.alignment !== "all" && row.alignment !== filters.alignment) return false;
  return true;
}

type SummaryTile = {
  key: string;
  label: string;
  /**
   * null when there is nothing to count from (no plan compared, no form
   * recorded): the tile shows no number rather than a "(0)" that reads as a
   * clean review (COL-649).
   */
  count: number | null;
  /** What the count is out of; every tile states it so a zero is never universal by implication. */
  denominator: string;
  tone: FilterPillTone;
  /** The filter this tile applies when pressed; its definition matches the rows exactly. */
  filters: Partial<Filters>;
};

export function buildSummaryTiles(counts: Form1823AlignmentCounts): SummaryTile[] {
  const recorded = counts.residents - counts.noForm1823;
  return [
    {
      key: "not_recorded",
      label: "Form 1823 not recorded",
      count: counts.noForm1823,
      denominator: `of ${counts.residents} residents`,
      tone: "danger",
      filters: { document: "not_recorded" },
    },
    {
      key: "no_plan",
      label: "No active care plan",
      count: counts.noPlan,
      denominator: `of ${counts.residents} residents`,
      tone: "warning",
      filters: { plan: "none" },
    },
    {
      key: "cannot_assess",
      label: "Alignment cannot be assessed",
      count: counts.cannotAssess,
      denominator: `of ${counts.residents} residents`,
      tone: "default",
      filters: { alignment: "cannot_assess" },
    },
    {
      key: "gaps",
      label: "Needs the plan does not answer",
      count: counts.compared > 0 ? counts.withGaps : null,
      denominator: counts.compared > 0 ? `of ${counts.compared} compared` : "none compared yet",
      tone: "warning",
      filters: { alignment: "gaps" },
    },
    {
      key: "stale",
      label: `1823 expired or older than ${FORM_1823_MAX_AGE_YEARS} years`,
      count: recorded > 0 ? counts.expiredForm1823 + counts.overAgeForm1823 : null,
      denominator: recorded > 0 ? `of ${recorded} recorded` : "none recorded",
      tone: "warning",
      filters: { document: "stale" },
    },
  ];
}

function tileIsActive(tile: SummaryTile, filters: Filters): boolean {
  return (Object.keys(tile.filters) as Array<keyof Filters>).every((key) => filters[key] === tile.filters[key]);
}

const rowActionClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 gap-1 px-2.5 text-xs");

/** The StatusPill tones meet AA on their own tint (COL-411 / COL-658). */
function Pill({ tone, children }: { tone: StatusPillTone; children: React.ReactNode }) {
  return <StatusPill tone={tone}>{children}</StatusPill>;
}

/**
 * Resident-by-resident review queue: for every current resident in scope,
 * what Form 1823 is recorded in Haven, whether an active care plan exists,
 * and whether that plan answers what the form says. The comparison is
 * automatic; a nurse confirms it on the resident's care-plan page.
 */
export function Form1823AlignmentPageClient({ initialRoster, initialError, initialFacilityId }: Props) {
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);
  const availableFacilities = useFacilityStore((state) => state.availableFacilities);
  const [roster, setRoster] = useState<Form1823AlignmentRoster | null>(initialRoster);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const skipNextLoadRef = useRef(initialError == null);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;
    setIsLoading(true);
    setError(null);
    try {
      setRoster(await fetchForm1823AlignmentRoster(selectedFacilityId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Form 1823 alignment.");
      setRoster(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    // Deferred so the read starts after paint rather than inside the effect body.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const postedFacilityName = selectedFacilityId
    ? (availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? null)
    : null;
  const facilityTitle = formatForm1823AlignmentFacilityTitle(
    selectedFacilityId,
    postedFacilityName,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () => (roster ? roster.rows.filter((row) => matchesFilters(row, filters, normalizedQuery)) : []),
    [roster, filters, normalizedQuery],
  );
  const tiles = useMemo(() => (roster ? buildSummaryTiles(roster.counts) : []), [roster]);
  const filtersApplied = normalizedQuery.length > 0 || filters.document !== "all" || filters.plan !== "all" || filters.alignment !== "all";

  const toggleTile = (tile: SummaryTile) => {
    setFilters((current) => {
      if (tileIsActive(tile, filters)) {
        const next = { ...current };
        for (const key of Object.keys(tile.filters) as Array<keyof Filters>) next[key] = "all";
        return next;
      }
      return { ...NO_FILTERS, ...tile.filters };
    });
  };

  const clearFilters = () => {
    setQuery("");
    setFilters(NO_FILTERS);
  };

  return (
    <div className="space-y-6 pb-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Form 1823 and care plans</h1>
        <p className="text-sm text-muted-foreground">
          {facilityTitle}
          {roster ? ` · ${roster.counts.residents} current resident${roster.counts.residents === 1 ? "" : "s"}` : ""}
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review each resident&apos;s Form 1823 as recorded in Haven and whether the active care plan answers it. The comparison
          is automatic; confirm it on the resident&apos;s care plan.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading Form 1823 alignment">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : error || !roster ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ShieldAlert className="size-6 text-destructive" aria-hidden />
            <h2 className="text-base font-semibold text-foreground">Form 1823 alignment unavailable</h2>
            <p className="text-sm text-muted-foreground">{error ?? "Unable to load Form 1823 alignment."}</p>
            <button type="button" onClick={() => void load()} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Retry
            </button>
          </CardContent>
        </Card>
      ) : roster.rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-base font-semibold text-foreground">No current residents in scope</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {formatForm1823AlignmentEmptyRosterCopy(postedFacilityName)}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-labelledby="form-1823-summary" className="space-y-2">
            <h2 id="form-1823-summary" className="text-xs font-medium text-muted-foreground">
              Summary · press a count to filter the list
            </h2>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {tiles.map((tile) => {
                const active = tileIsActive(tile, filters);
                return (
                  <li key={tile.key} className="flex flex-col gap-1">
                    <FilterPill
                      label={tile.label}
                      count={tile.count ?? undefined}
                      tone={tile.tone}
                      active={active}
                      aria-label={
                        tile.count === null ? `${tile.label}: ${tile.denominator}` : `${tile.label}: ${tile.count} ${tile.denominator}`
                      }
                      onClick={() => toggleTile(tile)}
                    />
                    <span className="pl-1 text-[11px] text-muted-foreground">{tile.denominator}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Find residents" className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1 sm:max-w-xs">
              <Label htmlFor="form-1823-search" className="text-xs text-muted-foreground">
                Search residents
              </Label>
              <Input
                id="form-1823-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Resident name"
                autoComplete="off"
              />
            </div>
            <FilterSelect
              id="form-1823-filter-document"
              label="Form 1823"
              value={filters.document}
              onChange={(value) => setFilters((current) => ({ ...current, document: value as DocumentFilter }))}
              options={[
                { value: "all", label: "Any" },
                { value: "not_recorded", label: FORM_1823_NOT_RECORDED_COPY },
                { value: "recorded", label: "Recorded" },
                { value: "stale", label: `Expired or older than ${FORM_1823_MAX_AGE_YEARS} years` },
              ]}
            />
            <FilterSelect
              id="form-1823-filter-plan"
              label="Active plan"
              value={filters.plan}
              onChange={(value) => setFilters((current) => ({ ...current, plan: value as PlanFilter }))}
              options={[
                { value: "all", label: "Any" },
                { value: "none", label: "No active plan" },
                { value: "active", label: "Active plan" },
              ]}
            />
            <FilterSelect
              id="form-1823-filter-alignment"
              label="Alignment"
              value={filters.alignment}
              onChange={(value) => setFilters((current) => ({ ...current, alignment: value as AlignmentFilter }))}
              options={[
                { value: "all", label: "Any" },
                { value: "cannot_assess", label: ALIGNMENT_COPY.cannot_assess.label },
                { value: "no_plan", label: ALIGNMENT_COPY.no_plan.label },
                { value: "gaps", label: ALIGNMENT_COPY.gaps.label },
                { value: "answered", label: ALIGNMENT_COPY.answered.label },
              ]}
            />
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {visibleRows.length} of {roster.counts.residents} resident{roster.counts.residents === 1 ? "" : "s"}
            </p>
            {filtersApplied ? (
              <button type="button" onClick={clearFilters} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 text-xs")}>
                Clear filters
              </button>
            ) : null}
          </section>

          {visibleRows.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No residents match these filters.{" "}
                <button type="button" onClick={clearFilters} className="font-medium text-primary underline-offset-4 hover:underline">
                  Show all residents
                </button>
              </CardContent>
            </Card>
          ) : (
            <Card className="py-0 hover:translate-y-0 lg:py-0">
              <CardContent className="p-0">
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead scope="col">Resident</TableHead>
                        <TableHead scope="col">Form 1823</TableHead>
                        <TableHead scope="col">Active plan</TableHead>
                        <TableHead scope="col">Alignment</TableHead>
                        <TableHead scope="col" className="text-right">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map((row) => (
                        <TableRow key={row.residentId}>
                          <TableCell className="font-medium text-foreground">{row.residentName}</TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="flex flex-col items-start gap-0.5">
                              <Pill tone={formTone(row)}>{formLabel(row)}</Pill>
                              {row.form1823 ? <span className="text-xs text-muted-foreground">{row.form1823.ageLabel}</span> : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Pill tone={row.plan ? "muted" : "warning"}>{planLabel(row)}</Pill>
                          </TableCell>
                          <TableCell className="max-w-[28rem] whitespace-normal">
                            <div className="flex flex-col items-start gap-0.5">
                              <Pill tone={ALIGNMENT_COPY[row.alignment].tone}>{alignmentLabel(row)}</Pill>
                              <span className="text-xs text-muted-foreground">{alignmentDetail(row)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <RowAction row={row} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="list-none divide-y divide-border p-0 md:hidden">
                  {visibleRows.map((row) => (
                    <li key={row.residentId} className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-foreground">{row.residentName}</span>
                        <RowAction row={row} />
                      </div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">Form 1823</dt>
                        <dd className="flex flex-col items-start gap-0.5">
                          <Pill tone={formTone(row)}>{formLabel(row)}</Pill>
                          {row.form1823 ? <span className="text-muted-foreground">{row.form1823.ageLabel}</span> : null}
                        </dd>
                        <dt className="text-muted-foreground">Active plan</dt>
                        <dd>
                          <Pill tone={row.plan ? "muted" : "warning"}>{planLabel(row)}</Pill>
                        </dd>
                        <dt className="text-muted-foreground">Alignment</dt>
                        <dd className="flex flex-col items-start gap-0.5">
                          <Pill tone={ALIGNMENT_COPY[row.alignment].tone}>{alignmentLabel(row)}</Pill>
                          <span className="text-muted-foreground">{alignmentDetail(row)}</span>
                        </dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function RowAction({ row }: { row: Form1823AlignmentRosterRow }) {
  return (
    <Link href={row.action.href} className={rowActionClass} aria-label={`${row.action.label} for ${row.residentName}`}>
      {row.action.label}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function FilterSelect(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger id={props.id} className="h-9 w-[min(100vw-2rem,220px)] rounded-[var(--radius)] bg-background" aria-label={props.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
