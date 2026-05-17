"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import {
  fetchResidentsFromSupabase,
  type Acuity,
  type AdlStatus,
  type ResidencyStatus,
  type ResidentRow,
} from "@/lib/residents/load-residents";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { TABLE_HEADER_CLASS, TABLE_ROW_CLASS } from "@/lib/design/row-classes";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

const DEFAULT_FILTERS = {
  search: "",
  acuity: "all",
  unit: "all",
  adl: "all",
  status: "all",
};

type AdminResidentsPageClientProps = {
  initialRows: ResidentRow[];
  initialError: string | null;
  initialFacilityId: string | null;
};

export function AdminResidentsPageClient({
  initialRows,
  initialError,
  initialFacilityId,
}: AdminResidentsPageClientProps) {
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ResidentRow[]>(initialRows);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  // Skip the first client-side fetch when the server already supplied data
  // for the current facility. Any later facility scope change falls through.
  const skipNextLoadRef = useRef(initialError == null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [acuity, setAcuity] = useState(DEFAULT_FILTERS.acuity);
  const [unit, setUnit] = useState(DEFAULT_FILTERS.unit);
  const [adl, setAdl] = useState(DEFAULT_FILTERS.adl);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);

  const loadResidents = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setIsLoading(true);
    setError(null);

    try {
      const liveRows = await fetchResidentsFromSupabase(selectedFacilityId);
      setRows(liveRows);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    const requestedSearch = searchParams.get("search") ?? DEFAULT_FILTERS.search;
    const requestedAcuity = searchParams.get("acuity") ?? DEFAULT_FILTERS.acuity;
    const requestedUnit = searchParams.get("unit") ?? DEFAULT_FILTERS.unit;
    const requestedAdl = searchParams.get("adl") ?? DEFAULT_FILTERS.adl;
    const requestedStatus = searchParams.get("status") ?? DEFAULT_FILTERS.status;

    setSearch(requestedSearch);
    setAcuity(["all", "1", "2", "3", "watchlist"].includes(requestedAcuity) ? requestedAcuity : DEFAULT_FILTERS.acuity);
    setUnit(requestedUnit || DEFAULT_FILTERS.unit);
    setAdl(
      ["all", "independent", "assisted", "dependent"].includes(requestedAdl)
        ? requestedAdl
        : DEFAULT_FILTERS.adl,
    );
    setStatus(
      ["all", "active", "hospital", "loa", "away"].includes(requestedStatus)
        ? requestedStatus
        : DEFAULT_FILTERS.status,
    );
  }, [searchParams]);

  const unitOptions = useMemo(() => {
    const distinctUnits = Array.from(new Set(rows.map((row) => row.unit))).sort((a, b) =>
      a.localeCompare(b),
    );

    return [{ value: "all", label: "All Units" }, ...distinctUnits.map((name) => ({ value: name, label: name }))];
  }, [rows]);

  const applyResidentFilters = useCallback(
    (
      input: ResidentRow[],
      overrides?: Partial<{
        search: string;
        acuity: string;
        unit: string;
        adl: string;
        status: string;
      }>,
    ) => {
      const effectiveSearch = overrides?.search ?? search;
      const effectiveAcuity = overrides?.acuity ?? acuity;
      const effectiveUnit = overrides?.unit ?? unit;
      const effectiveAdl = overrides?.adl ?? adl;
      const effectiveStatus = overrides?.status ?? status;
      const loweredSearch = effectiveSearch.trim().toLowerCase();

      return input.filter((row) => {
        const matchesSearch =
          loweredSearch.length === 0 ||
          row.name.toLowerCase().includes(loweredSearch) ||
          row.room.toLowerCase().includes(loweredSearch) ||
          row.careSummary.toLowerCase().includes(loweredSearch);
        const matchesAcuity =
          effectiveAcuity === "all" ||
          (effectiveAcuity === "watchlist" ? row.acuity === 2 || row.acuity === 3 : String(row.acuity) === effectiveAcuity);
        const matchesUnit = effectiveUnit === "all" || row.unit === effectiveUnit;
        const matchesAdl = effectiveAdl === "all" || row.adlStatus === effectiveAdl;
        const matchesStatus =
          effectiveStatus === "all" ||
          (effectiveStatus === "away" ? row.status === "hospital" || row.status === "loa" : row.status === effectiveStatus);

        return matchesSearch && matchesAcuity && matchesUnit && matchesAdl && matchesStatus;
      });
    },
    [search, acuity, unit, adl, status],
  );

  const filteredRows = useMemo(() => applyResidentFilters(rows), [applyResidentFilters, rows]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No residents in this scope",
          description:
            "Live resident roster returned no residents for the selected facility. Use Add resident or choose a different facility.",
        },
        whenFiltersExcludeAll: {
          title: "No residents match the current filters",
          description:
            "Try broadening search, acuity, unit, ADL, or residency status filters. Live resident data is scoped by your current facility selection.",
        },
      }),
    [rows.length],
  );

  const residentsInViewCount = filteredRows.length;
  const highAcuityInViewCount = filteredRows.filter((row) => row.acuity === 3).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header — flat, dense, no hero card. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="inline-flex items-center gap-2 text-[20px] font-semibold tracking-tight text-foreground">
            Resident hub
            {highAcuityInViewCount > 0 && <></>}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Unified census view with acuity &amp; ADL scope.
          </p>
        </div>
        <Link
          href="/admin/residents/new"
          className={cn(
            buttonVariants({ size: "default" }),
            "h-9 px-3 text-[12px] font-medium",
          )}
        >
          New resident
        </Link>
      </div>

      {/* KPI strip — flat tiles, tabular-nums, no gradient text.
          Two tiles → cap at max-w-2xl so they don't stretch into a wide
          band on >= 2xl viewports. (When this strip grows to 4+ tiles,
          drop the cap and use the 2/3/5 responsive grid.) */}
      <div className="grid max-w-2xl grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Users className="size-3.5" aria-hidden /> Residents in view
          </span>
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {residentsInViewCount}
          </span>
        </div>
        <div className={cn(
          "flex flex-col gap-1.5 rounded-lg border bg-card p-4",
          highAcuityInViewCount > 0 ? "border-destructive/30" : "border-border",
        )}>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            High acuity in view
          </span>
          <span className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            highAcuityInViewCount > 0 ? "text-destructive" : "text-foreground",
          )}>
            {highAcuityInViewCount}
          </span>
        </div>
      </div>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search resident, room, or care note..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "acuity",
            value: acuity,
            onChange: setAcuity,
            options: [
              { value: "all", label: `All Acuity (${applyResidentFilters(rows, { acuity: "all" }).length})` },
              { value: "watchlist", label: `Watchlist (2-3) (${applyResidentFilters(rows, { acuity: "watchlist" }).length})` },
              { value: "1", label: `Acuity 1 (${applyResidentFilters(rows, { acuity: "1" }).length})` },
              { value: "2", label: `Acuity 2 (${applyResidentFilters(rows, { acuity: "2" }).length})` },
              { value: "3", label: `Acuity 3 (${applyResidentFilters(rows, { acuity: "3" }).length})` },
            ],
          },
          {
            id: "unit",
            value: unit,
            onChange: setUnit,
            options: [
              { value: "all", label: `All Units (${applyResidentFilters(rows, { unit: "all" }).length})` },
              ...unitOptions
                .filter((option) => option.value !== "all")
                .map((option) => ({
                  value: option.value,
                  label: `${option.label} (${applyResidentFilters(rows, { unit: option.value }).length})`,
                })),
            ],
          },
          {
            id: "adl",
            value: adl,
            onChange: setAdl,
            options: [
              { value: "all", label: `All ADL Status (${applyResidentFilters(rows, { adl: "all" }).length})` },
              { value: "independent", label: `Independent (${applyResidentFilters(rows, { adl: "independent" }).length})` },
              { value: "assisted", label: `Assisted (${applyResidentFilters(rows, { adl: "assisted" }).length})` },
              { value: "dependent", label: `Dependent (${applyResidentFilters(rows, { adl: "dependent" }).length})` },
            ],
          },
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: `All Residency Status (${applyResidentFilters(rows, { status: "all" }).length})` },
              { value: "active", label: `Active (${applyResidentFilters(rows, { status: "active" }).length})` },
              { value: "hospital", label: `Hospital (${applyResidentFilters(rows, { status: "hospital" }).length})` },
              { value: "loa", label: `LOA (${applyResidentFilters(rows, { status: "loa" }).length})` },
              { value: "away", label: `Hospital / LOA (${applyResidentFilters(rows, { status: "away" }).length})` },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setAcuity(DEFAULT_FILTERS.acuity);
          setUnit(DEFAULT_FILTERS.unit);
          setAdl(DEFAULT_FILTERS.adl);
          setStatus(DEFAULT_FILTERS.status);
        }}
      />
      {(search !== DEFAULT_FILTERS.search ||
        acuity !== DEFAULT_FILTERS.acuity ||
        unit !== DEFAULT_FILTERS.unit ||
        adl !== DEFAULT_FILTERS.adl ||
        status !== DEFAULT_FILTERS.status) ? (
        <div className="flex flex-wrap items-center gap-2">
          {search !== DEFAULT_FILTERS.search ? (
            <Badge variant="outline" className="border-info/20 bg-info/10 text-info">
              Search: {search}
            </Badge>
          ) : null}
          {acuity !== DEFAULT_FILTERS.acuity ? (
            <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
              Acuity: {acuity === "watchlist" ? "watchlist (2-3)" : acuity}
            </Badge>
          ) : null}
          {unit !== DEFAULT_FILTERS.unit ? (
            <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">
              Unit: {unit}
            </Badge>
          ) : null}
          {adl !== DEFAULT_FILTERS.adl ? (
            <Badge variant="outline" className="border-success/20 bg-success/10 text-success">
              ADL: {adl}
            </Badge>
          ) : null}
          {status !== DEFAULT_FILTERS.status ? (
            <Badge variant="outline" className="border-border bg-muted/40 text-muted-foreground">
              Status: {status === "away" ? "hospital / LOA" : status}
            </Badge>
          ) : null}
          <Link href="/admin/residents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
            Clear roster filters
          </Link>
        </div>
      ) : null}

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadResidents()} />
      ) : null}
      {!isLoading && !error && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && !error && filteredRows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className={cn("hidden lg:flex", TABLE_HEADER_CLASS)}>
            <div className="flex-[3]">Resident</div>
            <div className="flex-1">Location</div>
            <div className="flex-1">Acuity</div>
            <div className="flex-1">ADL</div>
            <div className="flex-1">Status</div>
            <div className="flex-1 text-right">Updated</div>
          </div>
          <MotionList className="space-y-1 p-1">
            {filteredRows.map((resident) => (
              <MotionItem key={resident.id}>
                <Link
                  href={`/admin/residents/${resident.id}`}
                  className={cn(TABLE_ROW_CLASS, "group")}
                >
                  <div className="flex-[3] flex items-center gap-2.5 min-w-0">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
                      {resident.initials}
                    </span>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {resident.name}
                      </span>
                      <span className="hidden md:inline truncate text-[11px] text-muted-foreground">
                        {resident.careSummary}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 flex items-baseline gap-2 min-w-0">
                    <span className="text-[13px] font-medium text-foreground truncate">{resident.room}</span>
                    <span className="hidden md:inline text-[11px] text-muted-foreground tabular-nums truncate">{resident.unit}</span>
                  </div>

                  <div className="flex-1">
                    <AcuityPill acuity={resident.acuity} />
                  </div>

                  <div className="flex-1">
                    <AdlPill status={resident.adlStatus} />
                  </div>

                  <div className="flex-1">
                    <ResidentStatusPill status={resident.status} />
                  </div>

                  <div className="flex-1 flex justify-end">
                    <span className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                      {resident.updatedAt}
                    </span>
                  </div>
                </Link>
              </MotionItem>
            ))}
          </MotionList>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Healthy default = Acuity 1 → neutral. Acuity 2 = warning, Acuity 3 = destructive.
 */
function AcuityPill({ acuity }: { acuity: Acuity }) {
  if (acuity === 3) return <StatusPill tone="destructive">Acuity 3</StatusPill>;
  if (acuity === 2) return <StatusPill tone="warning">Acuity 2</StatusPill>;
  return <StatusPill tone="neutral">Acuity 1</StatusPill>;
}

/**
 * Independent default = neutral. Assisted = info. Dependent = warning.
 */
function AdlPill({ status }: { status: AdlStatus }) {
  switch (status) {
    case "dependent":
      return <StatusPill tone="warning">Dependent</StatusPill>;
    case "assisted":
      return <StatusPill tone="info">Assisted</StatusPill>;
    case "independent":
    default:
      return <StatusPill tone="neutral">Independent</StatusPill>;
  }
}

/**
 * Healthy default = `active` (in facility) → neutral. Hospital = destructive. LOA = warning.
 */
function ResidentStatusPill({ status }: { status: ResidencyStatus }) {
  switch (status) {
    case "hospital":
      return <StatusPill tone="destructive">Hospital</StatusPill>;
    case "loa":
      return <StatusPill tone="warning">LOA</StatusPill>;
    case "active":
    default:
      return <StatusPill tone="neutral">In facility</StatusPill>;
  }
}
